import assert from "node:assert/strict";
import test from "node:test";
import { backupLocalData, MIGRATION_BACKUP_KEY } from "../src/data/migration/migrationBackup.js";
import { buildMigrationPayload, inspectMigrationPayload, summarizeLocalData } from "../src/data/migration/migrationTransformer.js";
import { validateLocalData } from "../src/data/migration/migrationValidation.js";
import { PROGRESS_STORAGE_KEY } from "../src/data/storage.js";
import { runControlledImport, MIGRATION_STATUS_KEY, WRITE_ORDER } from "../src/data/migration/controlledImportCore.js";

const USER_ID = "2d63ce9a-a14f-4d1e-b92c-c826264bf1b2";
const EMPTY = {
  version: 1,
  startDate: "2026-01-01",
  entries: {},
  customHabits: [],
  ritualSnapshots: {},
  weeklyReflections: {},
  monthlyReflections: {},
};

function fixture() {
  return {
    version: 1,
    startDate: "2025-12-15",
    entries: {
      "2025-12-16": {
        wake: { completed: true, value: null, completedAt: "2025-12-16T05:15:00.000Z" },
        water: { completed: true, value: 8, completedAt: "2025-12-16T12:00:00.000Z" },
        sunscreen: {
          completed: true,
          value: null,
          completedAt: "2025-12-16T08:30:00.000Z",
          applicationTimes: ["2025-12-16T08:30:00.000Z", "2025-12-16T12:30:00.000Z", "2025-12-16T16:30:00.000Z"],
        },
        "sleep-tracker": { completed: false, value: 8, completedAt: null },
        "custom-reading": { completed: true, value: 25, completedAt: "2025-12-16T20:00:00.000Z" },
      },
      "2025-12-18": {
        wake: { completed: false, value: null, completedAt: null },
      },
    },
    customHabits: [{
      id: "custom-reading", title: "Read a chapter", type: "measurable", unit: "pages", goal: 20,
      icon: "▤", theme: "knowledge", shortDescription: "A little learning", createdAt: "2025-12-16T00:00:00.000Z",
      archived: false, order: 2,
    }],
    ritualSnapshots: {
      "2025-12-16": [
        { id: "wake", title: "Wake Up Early", type: "boolean", icon: "☀", colors: { accent: "#c48a45" } },
        { id: "custom-reading", title: "Read a chapter", type: "measurable", unit: "pages", goal: 20, source: "custom", createdAt: "2025-12-16T00:00:00.000Z", archived: false, order: 2 },
        { id: "sleep-tracker", title: "Sleep Tracker", goalMin: 7, goalMax: 9, unit: "hours" },
      ],
      "2025-12-18": [{ id: "wake", title: "Wake Up Early", type: "boolean" }],
    },
    weeklyReflections: { "2025-12-15": { wins: "Kept going", challenges: "Late night", focus: "Rest" } },
    monthlyReflections: { "2025-12-01": { intention: "Move with care" } },
  };
}

test("empty version-one local data validates and maps to an empty program", async () => {
  const result = await buildMigrationPayload({ rawValue: JSON.stringify(EMPTY), userId: USER_ID });
  assert.equal(result.status, "valid");
  assert.equal(result.payload.program.start_date, EMPTY.startDate);
  assert.deepEqual(result.payload.dailyRitualEntries, []);
  assert.equal(result.summary.dailyRitualRecords, 0);
});

test("missing local data is an error and does not invent an arc date", () => {
  const result = validateLocalData(null);
  assert.equal(result.status, "invalid");
  assert.equal(result.errors[0].code, "LOCAL_DATA_MISSING");
});

test("multiple historical dates and daily records remain distinct", async () => {
  const result = await buildMigrationPayload({ rawValue: JSON.stringify(fixture()), userId: USER_ID });
  assert.equal(result.summary.recordedDays, 2);
  assert.equal(result.summary.dailyRitualRecords, 6);
  assert.deepEqual(result.payload.dailyRitualEntries.map((row) => row.entry_date), [
    "2025-12-16", "2025-12-16", "2025-12-16", "2025-12-16", "2025-12-16", "2025-12-18",
  ]);
});

test("custom habit identity, metadata, archive/order, and historical record are retained", async () => {
  const result = await buildMigrationPayload({ rawValue: JSON.stringify(fixture()), userId: USER_ID });
  const habit = result.payload.customHabits[0];
  const definition = result.payload.customHabitDefinitions[0];
  const daily = result.payload.dailyRitualEntries.find((row) => row.ritual_id === "custom-reading");
  assert.equal(habit.source_habit_id, "custom-reading");
  assert.equal(habit.created_at, "2025-12-16T00:00:00.000Z");
  assert.equal(habit.display_order, 2);
  assert.equal(definition.title, "Read a chapter");
  assert.equal(definition.habit_type, "measurable");
  assert.equal(definition.goal, 20);
  assert.equal(daily.custom_habit_id, habit.id);
  assert.equal(result.summary.customHabitHistoricalRecords, 1);
});

test("historical ritual snapshot JSON and ordering are preserved without catalog regeneration", async () => {
  const source = fixture();
  const result = await buildMigrationPayload({ rawValue: JSON.stringify(source), userId: USER_ID });
  const snapshots = result.payload.ritualSnapshots.filter((row) => row.snapshot_date === "2025-12-16");
  assert.deepEqual(snapshots.map(({ ritual_id, position }) => [ritual_id, position]), [
    ["wake", 0], ["custom-reading", 1], ["sleep-tracker", 2],
  ]);
  assert.deepEqual(snapshots[1].definition, source.ritualSnapshots["2025-12-16"][1]);
  assert.equal(result.summary.ritualSnapshots, 4);
});

test("all sunscreen application timestamps stay ordered and unchanged", async () => {
  const result = await buildMigrationPayload({ rawValue: JSON.stringify(fixture()), userId: USER_ID });
  const row = result.payload.dailyRitualEntries.find((entry) => entry.ritual_id === "sunscreen");
  assert.deepEqual(row.application_times, fixture().entries["2025-12-16"].sunscreen.applicationTimes);
  assert.equal(result.summary.sunscreenApplicationTimestamps, 3);
});

test("Sleep Tracker remains informational, non-completing, and retains its measured value", async () => {
  const result = await buildMigrationPayload({ rawValue: JSON.stringify(fixture()), userId: USER_ID });
  const sleep = result.payload.dailyRitualEntries.find((row) => row.ritual_id === "sleep-tracker");
  assert.equal(sleep.record_kind, "informational");
  assert.equal(sleep.completed, false);
  assert.equal(sleep.completed_at, null);
  assert.equal(sleep.value, 8);
});

test("weekly and monthly reflection keys and text are preserved", async () => {
  const source = fixture();
  const result = await buildMigrationPayload({ rawValue: JSON.stringify(source), userId: USER_ID });
  assert.deepEqual(
    [result.payload.weeklyReflections[0].week_start, result.payload.weeklyReflections[0].wins, result.payload.weeklyReflections[0].challenges, result.payload.weeklyReflections[0].focus],
    ["2025-12-15", source.weeklyReflections["2025-12-15"].wins, source.weeklyReflections["2025-12-15"].challenges, source.weeklyReflections["2025-12-15"].focus],
  );
  assert.deepEqual(
    [result.payload.monthlyReflections[0].month, result.payload.monthlyReflections[0].intention],
    ["2025-12-01", source.monthlyReflections["2025-12-01"].intention],
  );
});

test("invalid JSON, impossible dates, and unrepresentable fields fail without a payload", async () => {
  assert.equal(validateLocalData("{").errors[0].code, "INVALID_JSON");
  const invalid = fixture();
  invalid.entries["2025-02-30"] = { wake: { completed: false, value: null, completedAt: null } };
  const result = await buildMigrationPayload({ rawValue: JSON.stringify(invalid), userId: USER_ID });
  assert.equal(result.status, "invalid");
  assert.equal(result.payload, null);
  assert.ok(result.validation.errors.some((error) => error.code === "INVALID_ENTRY_DATE"));
});

test("duplicate custom IDs and completed informational records require attention", () => {
  const duplicate = fixture();
  duplicate.customHabits.push({ ...duplicate.customHabits[0] });
  assert.ok(validateLocalData(JSON.stringify(duplicate)).errors.some((error) => error.code === "DUPLICATE_CUSTOM_HABIT_ID"));
  const informational = fixture();
  informational.entries["2025-12-16"]["sleep-tracker"].completed = true;
  assert.ok(validateLocalData(JSON.stringify(informational)).errors.some((error) => error.code === "INFORMATIONAL_RITUAL_COMPLETION"));
});

test("conversion is deterministic and idempotent for the same owner and input", async () => {
  const rawValue = JSON.stringify(fixture());
  const first = await buildMigrationPayload({ rawValue, userId: USER_ID });
  const second = await buildMigrationPayload({ rawValue, userId: USER_ID });
  assert.deepEqual(second.payload, first.payload);
  assert.deepEqual(second.summary, first.summary);
  assert.notEqual(first.payload.program.id, (await buildMigrationPayload({ rawValue, userId: "818fa7ad-71b1-4be6-9eaa-b9ba0723017a" })).payload.program.id);
});

test("payload inspection checks ownership and preservation without exposing records", async () => {
  const data = fixture();
  const rawValue = JSON.stringify(data);
  const first = await buildMigrationPayload({ rawValue, userId: USER_ID });
  const repeated = await buildMigrationPayload({ rawValue, userId: USER_ID });
  const checks = inspectMigrationPayload({ data, payload: first.payload, repeatedPayload: repeated.payload, userId: USER_ID });
  assert.ok(Object.values(checks).every(Boolean));
});

test("normalization reports warnings and leaves the original serialized value untouched", () => {
  const source = { version: 1, startDate: "2026-01-01" };
  const rawValue = JSON.stringify(source);
  const result = validateLocalData(rawValue);
  assert.equal(result.status, "safely_normalizable");
  assert.equal(rawValue, JSON.stringify(source));
  assert.deepEqual(result.data.entries, {});
  assert.ok(result.warnings.length >= 5);
});

test("backup stores the exact raw source separately and never overwrites it", () => {
  const initial = JSON.stringify(fixture(), null, 2);
  const values = new Map([[PROGRESS_STORAGE_KEY, initial]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  const result = backupLocalData({ storage });
  assert.equal(result.backedUp, true);
  assert.equal(values.get(MIGRATION_BACKUP_KEY), initial);
  assert.equal(values.get(PROGRESS_STORAGE_KEY), initial);
  assert.equal(backupLocalData({ storage }).reused, true);
  values.set(PROGRESS_STORAGE_KEY, `${initial} `);
  assert.equal(backupLocalData({ storage }).error.code, "BACKUP_ALREADY_EXISTS_DIFFERENT_SOURCE");
  assert.equal(values.get(MIGRATION_BACKUP_KEY), initial);
});

test("preview summary counts every requested record category", () => {
  const validated = validateLocalData(JSON.stringify(fixture()));
  const summary = summarizeLocalData(validated.data);
  assert.deepEqual(summary, {
    sourceVersion: 1,
    arcStartDate: "2025-12-15",
    recordedDays: 2,
    dailyRitualRecords: 6,
    completedBooleanRituals: 2,
    measurableRecords: 2,
    sunscreenDaysWithApplicationTimes: 1,
    sunscreenDaysWithTimestamps: 1,
    sunscreenApplicationTimestamps: 3,
    sleepTrackerRecords: 1,
    sleepTrackerNonCompletionRecords: 1,
    ritualSnapshots: 4,
    customHabits: 1,
    customHabitHistoricalRecords: 1,
    weeklyReflections: 1,
    monthlyReflections: 1,
  });
});

test("invalid partial records can still be counted safely for an attention preview", () => {
  const result = validateLocalData(JSON.stringify({
    version: 1,
    startDate: "2026-01-01",
    entries: { "2026-01-02": { sunscreen: { completed: false, value: null, completedAt: null, applicationTimes: ["bad-time"] } } },
    customHabits: [null],
    ritualSnapshots: { "2026-01-02": "invalid" },
    weeklyReflections: {},
    monthlyReflections: {},
  }));
  assert.equal(result.status, "invalid");
  assert.equal(summarizeLocalData(result.data).dailyRitualRecords, 1);
});

function importStorage(source = fixture()) {
  const values = new Map([[PROGRESS_STORAGE_KEY, JSON.stringify(source)]]);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function mockMigrationRepository({ existingPrograms = [], failTable = null, wrongReadback = false } = {}) {
  const tables = new Map();
  const calls = [];
  return {
    tables,
    calls,
    async getAuthenticatedUserId() { return { data: USER_ID, error: null }; },
    async listAuthenticatedPrograms() {
      const programs = tables.get("arc_programs") || existingPrograms;
      return { data: programs, error: null };
    },
    async insertMigrationRows(table, rows) {
      calls.push(table);
      if (table === failTable) return { data: null, error: { code: "SYNTHETIC_WRITE_FAILURE" } };
      const saved = tables.get(table) || [];
      const newRows = rows.filter((row) => !saved.some((item) => item.id === row.id));
      tables.set(table, [...saved, ...newRows]);
      return { data: newRows.map(({ id }) => ({ id })), error: null };
    },
    async verifyMigrationPayload(payload) {
      for (const [table, key] of [
        ["arc_programs", "program"], ["custom_habits", "customHabits"],
        ["custom_habit_definitions", "customHabitDefinitions"], ["ritual_snapshots", "ritualSnapshots"],
        ["daily_ritual_entries", "dailyRitualEntries"], ["weekly_reflections", "weeklyReflections"],
        ["monthly_reflections", "monthlyReflections"],
      ]) {
        const expected = key === "program" ? [payload.program] : payload[key];
        let actual = tables.get(table) || [];
        if (wrongReadback && table === "daily_ritual_entries" && actual.length) actual = actual.slice(1);
        if (actual.length !== expected.length) return { verified: false, error: { code: "MIGRATION_VERIFY_COUNT_MISMATCH", table } };
        if (actual.some((row) => row.user_id !== USER_ID)) return { verified: false, error: { code: "MIGRATION_VERIFY_CONTENT_MISMATCH", table } };
        if (JSON.stringify(actual) !== JSON.stringify(expected)) return { verified: false, error: { code: "MIGRATION_VERIFY_CONTENT_MISMATCH", table } };
      }
      return { verified: true, error: null };
    },
  };
}

test("controlled import backs up exact source, writes owned deterministic rows, verifies read-back, and preserves localStorage", async () => {
  const storage = importStorage();
  const sourceBefore = storage.getItem(PROGRESS_STORAGE_KEY);
  const repository = mockMigrationRepository();
  const result = await runControlledImport({ storage, repository });
  assert.equal(result.state, "verified");
  assert.equal(result.readbackVerified, true);
  assert.equal(result.localStorageUnchanged, true);
  assert.deepEqual(repository.calls, WRITE_ORDER.map(([table]) => table));
  assert.equal(storage.getItem(MIGRATION_BACKUP_KEY), sourceBefore);
  assert.equal(storage.getItem(PROGRESS_STORAGE_KEY), sourceBefore);
  assert.equal(JSON.parse(storage.getItem(MIGRATION_STATUS_KEY)).state, "verified");
  assert.equal(result.recordsWrittenByTable.daily_ritual_entries, 6);
  assert.ok([...repository.tables.values()].flat().every((row) => row.user_id === USER_ID));
  const daily = repository.tables.get("daily_ritual_entries");
  assert.deepEqual(daily.find((row) => row.ritual_id === "sunscreen").application_times, fixture().entries["2025-12-16"].sunscreen.applicationTimes);
  const tracker = daily.find((row) => row.ritual_id === "sleep-tracker");
  assert.equal(tracker.completed, false);
  assert.equal(tracker.record_kind, "informational");
});

test("controlled import stops before writes when a cloud program already exists", async () => {
  const storage = importStorage();
  const repository = mockMigrationRepository({ existingPrograms: [{ id: "some-other-program" }] });
  const result = await runControlledImport({ storage, repository });
  assert.equal(result.error.code, "CLOUD_DATA_ALREADY_EXISTS");
  assert.equal(repository.calls.length, 0);
  assert.equal(JSON.parse(storage.getItem(MIGRATION_STATUS_KEY)).state, "ready");
});

test("controlled import stops before writes if account or source changed after preview", async () => {
  const accountStorage = importStorage();
  const accountRepository = mockMigrationRepository();
  const wrongAccount = await runControlledImport({
    storage: accountStorage, repository: accountRepository, expectedUserId: "818fa7ad-71b1-4be6-9eaa-b9ba0723017a",
  });
  assert.equal(wrongAccount.error.code, "AUTHENTICATED_ACCOUNT_CHANGED");
  assert.equal(accountRepository.calls.length, 0);

  const sourceStorage = importStorage();
  const approvedValue = sourceStorage.getItem(PROGRESS_STORAGE_KEY);
  sourceStorage.setItem(PROGRESS_STORAGE_KEY, `${approvedValue} `);
  const sourceRepository = mockMigrationRepository();
  const changedSource = await runControlledImport({
    storage: sourceStorage, repository: sourceRepository, expectedRawValue: approvedValue,
  });
  assert.equal(changedSource.error.code, "LOCAL_SOURCE_CHANGED_SINCE_PREVIEW");
  assert.equal(sourceRepository.calls.length, 0);
});

test("failed read-back marks migration failed and reports the differing table", async () => {
  const storage = importStorage();
  const repository = mockMigrationRepository({ wrongReadback: true });
  const result = await runControlledImport({ storage, repository });
  assert.equal(result.state, "failed");
  assert.equal(result.error.code, "MIGRATION_VERIFY_COUNT_MISMATCH");
  assert.equal(result.error.verification.table, "daily_ritual_entries");
  assert.equal(JSON.parse(storage.getItem(MIGRATION_STATUS_KEY)).state, "failed");
  assert.ok(storage.getItem(PROGRESS_STORAGE_KEY));
});

test("safe retry resumes only its matching deterministic partial import", async () => {
  const storage = importStorage();
  const failing = mockMigrationRepository({ failTable: "ritual_snapshots" });
  const first = await runControlledImport({ storage, repository: failing });
  assert.equal(first.state, "failed");
  assert.equal(first.error.code, "SYNTHETIC_WRITE_FAILURE");
  const originalProgramId = failing.tables.get("arc_programs")[0].id;

  const retry = mockMigrationRepository();
  for (const [table, rows] of failing.tables) retry.tables.set(table, rows);
  const second = await runControlledImport({ storage, repository: retry });
  assert.equal(second.state, "verified");
  assert.equal(retry.tables.get("arc_programs")[0].id, originalProgramId);
  assert.equal(retry.tables.get("daily_ritual_entries").length, 6);
  assert.equal(JSON.parse(storage.getItem(MIGRATION_STATUS_KEY)).state, "verified");
});
