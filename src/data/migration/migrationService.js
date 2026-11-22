import { getAuthenticatedUserId, listAuthenticatedPrograms, MIGRATION_DUPLICATE_STRATEGY } from "./migrationRepository.js";
import { buildMigrationPayload, inspectMigrationPayload, summarizeLocalData } from "./migrationTransformer.js";
import { validateLocalData } from "./migrationValidation.js";
import { PROGRESS_STORAGE_KEY } from "../storage.js";
import { MIGRATION_BACKUP_KEY } from "./migrationBackup.js";
import { MIGRATION_STATUS_KEY, MIGRATION_STATES, runControlledImport } from "./controlledImportCore.js";
import * as migrationRepository from "./migrationRepository.js";

export { MIGRATION_BACKUP_KEY };
export { MIGRATION_STATUS_KEY, MIGRATION_STATES };

function browserStorage(storage) {
  return storage || (typeof window !== "undefined" ? window.localStorage : null);
}

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

function readSource(storage) {
  try {
    return { rawValue: storage?.getItem(PROGRESS_STORAGE_KEY) ?? null, error: null };
  } catch {
    return { rawValue: null, error: "LOCAL_STORAGE_UNAVAILABLE" };
  }
}

export async function createMigrationPreview({ storage: providedStorage } = {}) {
  const storage = browserStorage(providedStorage);
  const source = readSource(storage);
  const validation = source.error
    ? { status: "invalid", data: null, errors: [{ code: source.error, path: PROGRESS_STORAGE_KEY, message: "Local storage could not be read." }], warnings: [] }
    : validateLocalData(source.rawValue);

  const auth = await getAuthenticatedUserId();
  const authenticatedUserIdPresent = !auth.error && Boolean(auth.data);
  const summary = validation.data ? summarizeLocalData(validation.data) : null;
  let cloudDataAlreadyExists = null;
  let cloudCheckError = null;
  let migrationPreview = null;
  let payloadIntegrityChecks = null;

  if (authenticatedUserIdPresent) {
    const cloud = await listAuthenticatedPrograms();
    if (cloud.error) cloudCheckError = { code: cloud.error.code };
    else cloudDataAlreadyExists = (cloud.data || []).length > 0;
    if (validation.data) {
      const built = await buildMigrationPayload({ rawValue: source.rawValue, userId: auth.data });
      if (built.payload) {
        migrationPreview = built.summary;
        const repeated = await buildMigrationPayload({ rawValue: source.rawValue, userId: auth.data });
        payloadIntegrityChecks = inspectMigrationPayload({
          data: validation.data,
          payload: built.payload,
          repeatedPayload: repeated.payload,
          userId: auth.data,
        });
      }
    }
  }

  return {
    state: readStatus(storage).state,
    sourcePresent: !source.error && source.rawValue !== null,
    authenticatedUserIdPresent,
    authenticatedUserId: authenticatedUserIdPresent ? auth.data : null,
    sourceVersion: summary?.sourceVersion ?? null,
    arcStartDate: summary?.arcStartDate ?? null,
    recordedDays: summary?.recordedDays ?? 0,
    dailyRitualRecords: summary?.dailyRitualRecords ?? 0,
    completedBooleanRituals: summary?.completedBooleanRituals ?? 0,
    measurableRecords: summary?.measurableRecords ?? 0,
    sunscreenApplicationTimestamps: summary?.sunscreenApplicationTimestamps ?? 0,
    sunscreenDaysWithApplicationTimes: summary?.sunscreenDaysWithApplicationTimes ?? 0,
    sunscreenDaysWithTimestamps: summary?.sunscreenDaysWithTimestamps ?? 0,
    sleepTrackerRecords: summary?.sleepTrackerRecords ?? 0,
    sleepTrackerNonCompletionRecords: summary?.sleepTrackerNonCompletionRecords ?? 0,
    ritualSnapshots: summary?.ritualSnapshots ?? 0,
    customHabits: summary?.customHabits ?? 0,
    customHabitHistoricalRecords: summary?.customHabitHistoricalRecords ?? 0,
    weeklyReflections: summary?.weeklyReflections ?? 0,
    monthlyReflections: summary?.monthlyReflections ?? 0,
    validation: { status: validation.status, warnings: validation.warnings, errors: validation.errors },
    cloudDataAlreadyExists,
    cloudCheckError,
    migrationPreview,
    payloadIntegrityChecks,
    duplicateDetectionStrategy: MIGRATION_DUPLICATE_STRATEGY,
  };
}

/** Explicit call target used only by the temporary development import route. */
export async function importToCloud({ storage: providedStorage, expectedUserId, expectedRawValue } = {}) {
  const storage = browserStorage(providedStorage);
  return runControlledImport({ storage, repository: migrationRepository, expectedUserId, expectedRawValue });
}
