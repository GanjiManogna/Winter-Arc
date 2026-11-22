import { buildMigrationPayload } from "./migrationTransformer.js";
import { PROGRESS_STORAGE_KEY } from "../storage.js";
import { backupLocalData } from "./migrationBackup.js";

export const MIGRATION_STATUS_KEY = "winterArc.migration.v1";
export const MIGRATION_STATES = Object.freeze([
  "not_started", "validating", "ready", "importing", "verified", "failed",
]);

// custom_habit_id foreign keys require custom_habits before snapshots/entries.
export const WRITE_ORDER = Object.freeze([
  ["arc_programs", "program", "program"],
  ["custom_habits", "customHabits", "customHabits"],
  ["custom_habit_definitions", "customHabitDefinitions", "customHabitDefinitions"],
  ["ritual_snapshots", "ritualSnapshots", "ritualSnapshots"],
  ["daily_ritual_entries", "dailyRitualEntries", "dailyRitualEntries"],
  ["weekly_reflections", "weeklyReflections", "weeklyReflections"],
  ["monthly_reflections", "monthlyReflections", "monthlyReflections"],
]);

function readStatus(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(MIGRATION_STATUS_KEY) || "null");
    return parsed && MIGRATION_STATES.includes(parsed.state)
      ? parsed
      : { state: "not_started", completedStages: [] };
  } catch {
    return { state: "not_started", completedStages: [] };
  }
}

function writeStatus(storage, value) {
  const safe = {
    state: value.state,
    completedStages: Array.isArray(value.completedStages) ? value.completedStages : [],
    ...(value.ownerId ? { ownerId: value.ownerId } : {}),
    ...(value.programId ? { programId: value.programId } : {}),
    ...(value.sourceFingerprint ? { sourceFingerprint: value.sourceFingerprint } : {}),
    ...(value.updatedAt ? { updatedAt: value.updatedAt } : {}),
    ...(value.lastErrorCode ? { lastErrorCode: value.lastErrorCode } : {}),
    ...(value.lastOutcome ? { lastOutcome: value.lastOutcome } : {}),
  };
  storage?.setItem(MIGRATION_STATUS_KEY, JSON.stringify(safe));
  return safe;
}

function readSource(storage) {
  try {
    return { rawValue: storage?.getItem(PROGRESS_STORAGE_KEY) ?? null, error: null };
  } catch {
    return { rawValue: null, error: "LOCAL_STORAGE_UNAVAILABLE" };
  }
}

async function fingerprint(value) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is required for a stable migration fingerprint.");
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fail(storage, details, code, extra = {}) {
  const state = writeStatus(storage, {
    ...details,
    state: "failed",
    lastErrorCode: code,
    updatedAt: new Date().toISOString(),
  });
  return { state: state.state, error: { code, ...extra } };
}

/** Controlled, explicit import core. Dependencies are injected to keep the process testable. */
export async function runControlledImport({ storage, repository, backup = backupLocalData, expectedUserId, expectedRawValue } = {}) {
  const previousState = readStatus(storage);
  const source = readSource(storage);
  if (source.error || source.rawValue === null) {
    return fail(storage, previousState, source.error || "LOCAL_DATA_MISSING");
  }
  if (expectedRawValue !== undefined && source.rawValue !== expectedRawValue) {
    return fail(storage, previousState, "LOCAL_SOURCE_CHANGED_SINCE_PREVIEW");
  }

  const auth = await repository.getAuthenticatedUserId();
  if (auth.error || !auth.data) return fail(storage, previousState, auth.error?.code || "AUTHENTICATION_REQUIRED");
  if (expectedUserId && expectedUserId !== auth.data) {
    return fail(storage, previousState, "AUTHENTICATED_ACCOUNT_CHANGED");
  }

  const built = await buildMigrationPayload({ rawValue: source.rawValue, userId: auth.data });
  if (built.status === "invalid" || !built.payload) {
    return fail(storage, previousState, "LOCAL_VALIDATION_FAILED", { validation: built.validation });
  }

  const backupResult = backup({ storage });
  if (!backupResult.backedUp) return fail(storage, previousState, backupResult.error.code);

  let sourceFingerprint;
  try {
    sourceFingerprint = await fingerprint(source.rawValue);
  } catch {
    return fail(storage, previousState, "FINGERPRINT_FAILED");
  }

  if (previousState.state === "verified") {
    const sameVerifiedImport = previousState.ownerId === auth.data
      && previousState.programId === built.payload.program.id
      && previousState.sourceFingerprint === sourceFingerprint;
    if (sameVerifiedImport) return { state: "verified", alreadyVerified: true, error: null };
    return { state: "cloud_data_exists", migrationState: "verified", error: { code: "CLOUD_DATA_ALREADY_EXISTS" } };
  }

  writeStatus(storage, { ...previousState, state: "validating", updatedAt: new Date().toISOString() });
  writeStatus(storage, {
    ...previousState,
    state: "ready",
    ownerId: auth.data,
    programId: built.payload.program.id,
    sourceFingerprint,
    updatedAt: new Date().toISOString(),
  });

  const cloud = await repository.listAuthenticatedPrograms();
  if (cloud.error) return fail(storage, previousState, cloud.error.code);

  const programId = built.payload.program.id;
  const existingPrograms = cloud.data || [];
  const retryAllowed = previousState.programId === programId
    && previousState.ownerId === auth.data
    && previousState.sourceFingerprint === sourceFingerprint
    && ["importing", "failed"].includes(previousState.state);
  if (existingPrograms.length && !(existingPrograms.length === 1 && existingPrograms[0].id === programId && retryAllowed)) {
    writeStatus(storage, {
      ...previousState,
      state: "ready",
      lastOutcome: "cloud_data_exists",
      updatedAt: new Date().toISOString(),
    });
    return { state: "cloud_data_exists", migrationState: "ready", error: { code: "CLOUD_DATA_ALREADY_EXISTS" } };
  }

  // Prevent a stale preview/confirmation from importing a changed or replaced source.
  const sourceBeforeWrites = readSource(storage);
  if (sourceBeforeWrites.error || sourceBeforeWrites.rawValue !== source.rawValue) {
    return fail(storage, { ownerId: auth.data, programId, sourceFingerprint }, "LOCAL_STORAGE_INTEGRITY_MISMATCH");
  }

  const completedStages = retryAllowed ? [...previousState.completedStages] : [];
  const recordsWrittenByTable = {};
  writeStatus(storage, {
    state: "importing", ownerId: auth.data, programId, sourceFingerprint,
    completedStages, updatedAt: new Date().toISOString(),
  });

  for (const [table, payloadKey, stage] of WRITE_ORDER) {
    const rows = payloadKey === "program" ? [built.payload.program] : built.payload[payloadKey];
    const inserted = await repository.insertMigrationRows(table, rows);
    if (inserted.error) {
      return fail(storage, { ownerId: auth.data, programId, sourceFingerprint, completedStages }, inserted.error.code, {
        recordsWrittenByTable,
      });
    }
    recordsWrittenByTable[table] = inserted.data?.length ?? 0;
    if (!completedStages.includes(stage)) completedStages.push(stage);
    writeStatus(storage, {
      state: "importing", ownerId: auth.data, programId, sourceFingerprint,
      completedStages, updatedAt: new Date().toISOString(),
    });
  }

  const verification = await repository.verifyMigrationPayload(built.payload);
  if (!verification.verified) {
    return fail(storage, { ownerId: auth.data, programId, sourceFingerprint, completedStages }, verification.error?.code || "MIGRATION_VERIFY_FAILED", {
      verification: verification.error || null,
      recordsWrittenByTable,
    });
  }

  const sourceAfterWrites = readSource(storage);
  if (sourceAfterWrites.error || sourceAfterWrites.rawValue !== source.rawValue) {
    return fail(storage, { ownerId: auth.data, programId, sourceFingerprint, completedStages }, "LOCAL_STORAGE_INTEGRITY_MISMATCH", {
      recordsWrittenByTable,
      readbackVerified: true,
    });
  }

  writeStatus(storage, {
    state: "verified", ownerId: auth.data, programId, sourceFingerprint,
    completedStages, updatedAt: new Date().toISOString(),
  });
  return {
    state: "verified", completedStages, summary: built.summary,
    recordsWrittenByTable, readbackVerified: true, localStorageUnchanged: true, error: null,
  };
}
