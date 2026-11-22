import assert from "node:assert/strict";
import test from "node:test";
import { calculateSleepDuration, formatSleepDuration } from "../src/data/sleepDuration.js";
import { getDaySnapshotFromProgress, getProgressStorageKeyForAccount, getSleepSummaryFromProgress, loadProgress, toISODate, upsertRitualEntry } from "../src/data/storage.js";
import { reconstructCloudProgress } from "../src/data/cloud/reconstructCloudProgress.js";
import { saveDailyRitualEntry } from "../src/data/dailyRitualWriteService.js";
import { buildMigrationPayload } from "../src/data/migration/migrationTransformer.js";
import { readFileSync } from "node:fs";

const USER_ID = "2d63ce9a-a14f-4d1e-b92c-c826264bf1b2";
const PROGRAM_ID = "42a40a01-f8d8-4415-8dad-32f1db2ae573";

test("sleep duration handles overnight and supported same-day intervals", () => {
  assert.deepEqual(calculateSleepDuration("22:48", "06:32"), {
    durationMinutes: 464,
    durationHours: 464 / 60,
  });
  assert.deepEqual(calculateSleepDuration("23:30", "07:00"), {
    durationMinutes: 450,
    durationHours: 7.5,
  });
  assert.deepEqual(calculateSleepDuration("13:00", "14:15"), {
    durationMinutes: 75,
    durationHours: 1.25,
  });
  assert.equal(formatSleepDuration(464), "7h 44m");
});

test("sleep duration is unavailable for missing, malformed, zero, or implausible intervals", () => {
  assert.equal(calculateSleepDuration(null, "06:32"), null);
  assert.equal(calculateSleepDuration("22:48", ""), null);
  assert.equal(calculateSleepDuration("24:00", "06:32"), null);
  assert.equal(calculateSleepDuration("06:00", "06:00"), null);
  assert.equal(calculateSleepDuration("08:00", "01:00"), null);
});

test("Sleep On Time captures a separate editable time and retains the existing local cutoff guard", () => {
  const source = readFileSync(new URL("../src/components/RitualPage.jsx", import.meta.url), "utf8");
  assert.match(source, /sleepTime: !isComplete \? selectedLocalTime : null/);
  assert.match(source, /completedAt: !isComplete \? new Date\(\)\.toISOString\(\) : null/);
  assert.match(source, /canCompleteSleepOnTimeAt\(now\)/);
  assert.match(source, /max=\{ritual\.id === "sleep" \? "22:59" : undefined\}/);
  assert.match(source, /selectedSleepTimeIsBeforeCutoff = ritual\.id !== "sleep"/);
  assert.match(source, /!isLocalTime\(selectedLocalTime\) \|\| !selectedSleepTimeIsBeforeCutoff/);
});

test("dated snapshots calculate overnight sleep while preserving legacy manual values", () => {
  const progress = {
    startDate: "2026-01-01",
    customHabits: [],
    ritualSnapshots: {},
    entries: {
      "2026-01-02": { sleep: { completed: true, sleepTime: "22:48" } },
      "2026-01-03": {
        wake: { completed: true, wakeTime: "06:32" },
        "sleep-tracker": { completed: false, value: 7.5, completedAt: null },
      },
      "2026-01-04": { "sleep-tracker": { completed: false, value: 7.5, completedAt: null } },
    },
  };
  const calculated = getDaySnapshotFromProgress(progress, "2026-01-03");
  const sleep = calculated.rows.find(({ ritual }) => ritual.id === "sleep-tracker");
  assert.equal(sleep.status.value, 464 / 60);
  assert.equal(sleep.status.completed, false);
  assert.equal(calculated.completedCount, 1);
  assert.equal(calculated.rows.find(({ ritual }) => ritual.id === "sleep-tracker").entry.calculatedDurationMinutes, 464);

  const legacy = getDaySnapshotFromProgress(progress, "2026-01-04");
  assert.equal(legacy.rows.find(({ ritual }) => ritual.id === "sleep-tracker").status.value, 7.5);
});

test("home sleep summary supports complete, partial, missing, and legacy manual sleep data", () => {
  const date = "2026-01-03";
  const progress = {
    entries: {
      "2026-01-02": { sleep: { completed: true, sleepTime: "22:48" } },
      [date]: { wake: { completed: true, wakeTime: "06:32" }, "sleep-tracker": { value: 7.5, completed: false } },
    },
  };
  assert.deepEqual(getSleepSummaryFromProgress(progress, date), {
    sleepTime: "22:48", wakeTime: "06:32", durationMinutes: 464,
    durationHours: 464 / 60, manualHours: 7.5,
  });
  assert.deepEqual(getSleepSummaryFromProgress({ entries: { [date]: { wake: { completed: true, wakeTime: "06:32" } } } }, date), {
    sleepTime: null, wakeTime: "06:32", durationMinutes: null, durationHours: null, manualHours: null,
  });
  assert.deepEqual(getSleepSummaryFromProgress({ entries: {} }, date), {
    sleepTime: null, wakeTime: null, durationMinutes: null, durationHours: null, manualHours: null,
  });
  assert.equal(getSleepSummaryFromProgress({ entries: { [date]: { "sleep-tracker": { value: 6.25 } } } }, date).manualHours, 6.25);
  assert.equal(getSleepSummaryFromProgress({ entries: { [date]: { wake: { completed: false, wakeTime: "06:32" } } } }, date).wakeTime, null);
});

test("Today hides Sleep Tracker presentation while retaining it in shared data and authenticated Home uses lifecycle data", () => {
  const today = readFileSync(new URL("../src/components/TodayDashboard.jsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../src/components/LandingPage.jsx", import.meta.url), "utf8");
  const ritualPage = readFileSync(new URL("../src/components/RitualPage.jsx", import.meta.url), "utf8");
  assert.match(today, /rituals\.filter\(\(ritual\) => ritual\.id !== "sleep-tracker"\)/);
  assert.match(today, /visibleRituals\.map\(/);
  assert.match(today, /isInformationalRitual\(ritual\)/);
  assert.match(home, /useAccountDataLifecycle\(\)/);
  assert.match(home, /accountMode === "cloud-read-only"\s*\? account\.progress\s*:\s*localProgress/);
  assert.match(home, /isAuthenticated && progress/);
  assert.match(home, /getSleepSummaryFromProgress\(progress, dateISO\)/);
  assert.match(home, /to=\{isAuthenticated \? "\/ritual\/sleep-tracker" : "\/login"\}/);
  assert.match(home, /View Sleep Tracker/);
  assert.match(home, /A quiet invitation to begin tracking your rest\./);
  assert.doesNotMatch(home, /to="\/ritual\/(?:sleep|wake)" className="landing-sleep-summary__link"/);
  assert.match(ritualPage, /getSleepSummaryFromProgress\(progress, currentDateISO\)/);
  assert.match(ritualPage, /formatSleepClockTime\(sleepSummary\.sleepTime\)/);
  assert.match(ritualPage, /formatSleepClockTime\(sleepSummary\.wakeTime\)/);
  assert.match(ritualPage, /formatSleepDuration\(sleepSummary\.durationMinutes\)/);
  assert.match(ritualPage, /to="\/ritual\/sleep"[\s\S]*?returnTo: "\/ritual\/sleep-tracker"/);
  assert.match(ritualPage, /to="\/ritual\/wake"[\s\S]*?returnTo: "\/ritual\/sleep-tracker"/);
  assert.match(ritualPage, /!isSleepTrackerRitual \? <section className="ritual-card ritual-history"/);
  assert.match(ritualPage, /!isSleepTrackerRitual \? <section className="ritual-stats"/);
  assert.doesNotMatch(home, /localStorage\.getItem/);
});

test("local sleep and wake selections persist separately from completion timestamps", () => {
  const originalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  const values = new Map();
  globalThis.localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
  globalThis.window = { dispatchEvent() {} };
  try {
    const today = toISODate();
    const key = getProgressStorageKeyForAccount(null);
    localStorage.setItem(key, JSON.stringify({ version: 1, startDate: today, entries: {}, customHabits: [], ritualSnapshots: {}, weeklyReflections: {}, monthlyReflections: {} }));
    const sleepCompletedAt = new Date().toISOString();
    const wakeCompletedAt = new Date().toISOString();
    upsertRitualEntry("sleep", { completed: true, completedAt: sleepCompletedAt, sleepTime: "22:48" }, today);
    upsertRitualEntry("wake", { completed: true, completedAt: wakeCompletedAt, wakeTime: "06:32" }, today);
    const progress = loadProgress();
    assert.equal(progress.entries[today].sleep.sleepTime, "22:48");
    assert.equal(progress.entries[today].sleep.completedAt, sleepCompletedAt);
    assert.equal(progress.entries[today].wake.wakeTime, "06:32");
    assert.equal(progress.entries[today].wake.completedAt, wakeCompletedAt);
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("cloud reconstruction retains owner-scoped explicit times and rejects wrong ritual fields", () => {
  const base = { program_id: PROGRAM_ID, user_id: USER_ID, completed: true, value: null, completed_at: "2026-01-02T16:00:00.000Z", application_times: [] };
  const result = reconstructCloudProgress({
    program: { id: PROGRAM_ID, user_id: USER_ID, start_date: "2026-01-01", source_schema_version: 1 },
    dailyEntries: [
      { ...base, entry_date: "2026-01-02", ritual_id: "sleep", record_kind: "boolean", sleep_time: "22:48", wake_time: null },
      { ...base, entry_date: "2026-01-03", ritual_id: "wake", record_kind: "boolean", completed_at: "2026-01-03T01:00:00.000Z", sleep_time: null, wake_time: "06:32" },
    ],
  });
  assert.equal(result.error, null);
  assert.equal(result.data.entries["2026-01-02"].sleep.sleepTime, "22:48");
  assert.equal(result.data.entries["2026-01-03"].wake.wakeTime, "06:32");

  const invalid = reconstructCloudProgress({
    program: { id: PROGRAM_ID, user_id: USER_ID, start_date: "2026-01-01", source_schema_version: 1 },
    dailyEntries: [{ ...base, entry_date: "2026-01-02", ritual_id: "wake", record_kind: "boolean", sleep_time: "22:48", wake_time: null }],
  });
  assert.ok(invalid.error);
});

test("cloud daily writes and migration payload preserve selected sleep and wake times", async () => {
  const cloudWrites = [];
  const session = async () => ({ data: { user: { id: USER_ID } }, error: null });
  const sleepResult = await saveDailyRitualEntry({
    expectedUserId: USER_ID, expectedProgramId: PROGRAM_ID, dateISO: "2026-01-02", ritualId: "sleep",
    entry: { completed: true, value: null, completedAt: "2026-01-02T16:00:00.000Z", sleepTime: "22:48" },
    getSession: session,
    repository: { async writeDailyEntry(date, ritual, entry) { cloudWrites.push({ date, ritual, entry }); return { data: entry, error: null }; } },
  });
  const wakeResult = await saveDailyRitualEntry({
    expectedUserId: USER_ID, expectedProgramId: PROGRAM_ID, dateISO: "2026-01-03", ritualId: "wake",
    entry: { completed: true, value: null, completedAt: "2026-01-03T01:00:00.000Z", wakeTime: "06:32" },
    getSession: session,
    repository: { async writeDailyEntry(date, ritual, entry) { cloudWrites.push({ date, ritual, entry }); return { data: entry, error: null }; } },
  });
  assert.equal(sleepResult.data.sleepTime, "22:48");
  assert.equal(wakeResult.data.wakeTime, "06:32");

  const local = {
    version: 1, startDate: "2026-01-01", entries: {
      "2026-01-02": { sleep: { completed: true, completedAt: "2026-01-02T16:00:00.000Z", sleepTime: "22:48" } },
      "2026-01-03": { wake: { completed: true, completedAt: "2026-01-03T01:00:00.000Z", wakeTime: "06:32" }, "sleep-tracker": { completed: false, value: 7.5, completedAt: null } },
    },
    customHabits: [], ritualSnapshots: {}, weeklyReflections: {}, monthlyReflections: {},
  };
  const payload = await buildMigrationPayload({ rawValue: JSON.stringify(local), userId: USER_ID });
  assert.equal(payload.status, "safely_normalizable");
  assert.equal(payload.payload.dailyRitualEntries.find(({ ritual_id }) => ritual_id === "sleep").sleep_time, "22:48");
  assert.equal(payload.payload.dailyRitualEntries.find(({ ritual_id }) => ritual_id === "wake").wake_time, "06:32");
  assert.equal(payload.payload.dailyRitualEntries.find(({ ritual_id }) => ritual_id === "sleep-tracker").value, 7.5);
});
