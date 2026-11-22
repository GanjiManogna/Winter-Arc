import assert from "node:assert/strict";
import test from "node:test";
import { saveDailyRitualEntry } from "../src/data/dailyRitualWriteService.js";
import { createAccountDataController } from "../src/data/accountDataController.js";
import { getDailyAnalysisFromProgress } from "../src/data/dailyAnalysis.js";
import { getDaySnapshotFromProgress } from "../src/data/storage.js";
import { getWeeklyCheckinFromProgress } from "../src/data/weeklyAnalysis.js";
import { getMonthlyAnalysisFromProgress, getMonthKey } from "../src/data/monthlyAnalysis.js";
import { createTodayCloudModel } from "../src/data/todayCloudModel.js";
import { toISODate } from "../src/data/storage.js";

const USER_A = "account-a";
const USER_B = "account-b";
const PROGRAM_A = "program-a";
const DATE = toISODate();

function auth(userId) {
  return async () => ({ data: { user: { id: userId } }, error: null });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("authenticated write preserves measurable values and does not touch localStorage", async () => {
  const previous = globalThis.localStorage;
  const storageCalls = [];
  globalThis.localStorage = {
    getItem(...args) { storageCalls.push(["get", ...args]); throw new Error("cloud write used localStorage"); },
    setItem(...args) { storageCalls.push(["set", ...args]); throw new Error("cloud write used localStorage"); },
  };
  const sent = [];
  try {
    const result = await saveDailyRitualEntry({
      expectedUserId: USER_A, expectedProgramId: PROGRAM_A, dateISO: DATE,
      ritualId: "water",
      entry: { completed: false, value: 4, completedAt: null, applicationTimes: [] },
      getSession: auth(USER_A),
      repository: { async writeDailyEntry(...args) {
        sent.push(args);
        return { data: { completed: false, value: 4, completedAt: null, applicationTimes: [] }, error: null };
      } },
    });
    assert.equal(result.error, null);
    assert.equal(result.data.value, 4);
    assert.deepEqual(sent[0].slice(0, 2), [DATE, "water"]);
    assert.deepEqual(sent[0][3], { userId: USER_A, programId: PROGRAM_A });
    assert.deepEqual(storageCalls, []);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("boolean completion and completedAt survive the cloud write round trip", async () => {
  const completedAt = "2026-09-24T06:30:00.000Z";
  const result = await saveDailyRitualEntry({
    expectedUserId: USER_A, expectedProgramId: PROGRAM_A, dateISO: DATE,
    ritualId: "wake",
    entry: { completed: true, value: null, completedAt, applicationTimes: [] },
    getSession: auth(USER_A),
    repository: { async writeDailyEntry(_date, _ritual, entry) { return { data: entry, error: null }; } },
  });
  assert.deepEqual(result.data, { completed: true, value: null, completedAt, applicationTimes: [] });
});

test("explicit sleep and wake times survive authenticated cloud writes separately from completedAt", async () => {
  const sleep = { completed: true, value: null, completedAt: "2026-09-24T16:30:00.000Z", sleepTime: "22:48", applicationTimes: [] };
  const wake = { completed: true, value: null, completedAt: "2026-09-25T01:32:00.000Z", wakeTime: "06:32", applicationTimes: [] };
  for (const [ritualId, entry, timeField] of [["sleep", sleep, "sleepTime"], ["wake", wake, "wakeTime"]]) {
    const result = await saveDailyRitualEntry({
      expectedUserId: USER_A, expectedProgramId: PROGRAM_A, dateISO: DATE,
      ritualId, entry, getSession: auth(USER_A),
      repository: { async writeDailyEntry(_date, _ritualId, value) { return { data: value, error: null }; } },
    });
    assert.equal(result.error, null);
    assert.equal(result.data[timeField], entry[timeField]);
    assert.equal(result.data.completedAt, entry.completedAt);
  }
});

test("sunscreen application timestamps and ordering are retained", async () => {
  const applicationTimes = ["2026-10-02T07:30:00.000Z", "2026-10-02T10:30:00.000Z"];
  let received;
  const result = await saveDailyRitualEntry({
    expectedUserId: USER_A, expectedProgramId: PROGRAM_A, dateISO: DATE,
    ritualId: "sunscreen",
    entry: { completed: true, value: null, completedAt: applicationTimes[0], applicationTimes },
    getSession: auth(USER_A),
    repository: { async writeDailyEntry(_date, _ritual, entry) { received = entry; return { data: entry, error: null }; } },
  });
  assert.deepEqual(received.applicationTimes, applicationTimes);
  assert.deepEqual(result.data.applicationTimes, applicationTimes);
});

test("sleep tracker writes keep informational status and value", async () => {
  const value = 7.5;
  const result = await saveDailyRitualEntry({
    expectedUserId: USER_A, expectedProgramId: PROGRAM_A, dateISO: DATE,
    ritualId: "sleep-tracker",
    entry: { completed: false, value, completedAt: null, applicationTimes: [] },
    getSession: auth(USER_A),
    repository: { async writeDailyEntry(_date, _ritual, entry) {
      assert.equal(entry.completed, false);
      return { data: entry, error: null };
    } },
  });
  assert.equal(result.data.completed, false);
  assert.equal(result.data.value, value);
});

test("daily cloud writes reject dates beyond the supplied 92-day Arc", async () => {
  let writes = 0;
  const result = await saveDailyRitualEntry({
    expectedUserId: USER_A,
    expectedProgramId: PROGRAM_A,
    dateISO: "2026-04-03",
    arcStartDate: "2026-01-01",
    ritualId: "wake",
    entry: { completed: true, value: null, completedAt: "2026-04-03T08:00:00Z" },
    getSession: auth(USER_A),
    repository: { async writeDailyEntry() { writes += 1; return { data: {}, error: null }; } },
  });
  assert.equal(result.data, null);
  assert.equal(result.error.code, "ARC_COMPLETE");
  assert.equal(writes, 0);
});

test("failed cloud writes return an error and never claim success", async () => {
  const result = await saveDailyRitualEntry({
    expectedUserId: USER_A, expectedProgramId: PROGRAM_A, dateISO: DATE,
    ritualId: "steps", entry: { completed: false, value: 1000 }, getSession: auth(USER_A),
    repository: { async writeDailyEntry() { return { data: null, error: { code: "CLOUD_REQUEST_FAILED" } }; } },
  });
  assert.equal(result.data, null);
  assert.equal(result.error.code, "DAILY_SAVE_FAILED");
  assert.match(result.error.message, /last saved value has been restored/);
});

test("network failure is classified and keeps the confirmed cloud entry authoritative", async () => {
  const confirmed = { completed: false, value: 2500, completedAt: null, applicationTimes: [] };
  const previous = globalThis.localStorage;
  let localWrites = 0;
  globalThis.localStorage = {
    getItem() { return null; },
    setItem() { localWrites += 1; throw new Error("cloud failure must not use localStorage"); },
  };
  let result;
  try {
    result = await saveDailyRitualEntry({
      expectedUserId: USER_A, expectedProgramId: PROGRAM_A, dateISO: DATE,
      ritualId: "steps", entry: { ...confirmed, value: 5000 }, getSession: auth(USER_A),
      repository: { async writeDailyEntry() {
        return { data: null, error: { code: "CLOUD_NETWORK_ERROR" } };
      } },
    });
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
  assert.equal(result.error.code, "NETWORK_UNAVAILABLE");
  assert.deepEqual(confirmed, { completed: false, value: 2500, completedAt: null, applicationTimes: [] });
  assert.match(result.error.message, /last saved progress is safe/);
  assert.equal(localWrites, 0);
});

test("wrong or changed account cannot issue or complete a stale write", async () => {
  let writes = 0;
  const wrongOwner = await saveDailyRitualEntry({
    expectedUserId: USER_A, expectedProgramId: PROGRAM_A, dateISO: DATE,
    ritualId: "steps", entry: { value: 2500 }, getSession: auth(USER_B),
    repository: { async writeDailyEntry() { writes += 1; return { data: {}, error: null }; } },
  });
  assert.equal(wrongOwner.error.code, "AUTHENTICATION_CHANGED");
  assert.equal(writes, 0);

  const pending = deferred();
  let sessionReads = 0;
  const changedDuringWritePromise = saveDailyRitualEntry({
    expectedUserId: USER_A, expectedProgramId: PROGRAM_A, dateISO: DATE,
    ritualId: "steps", entry: { value: 2500 },
    getSession: async () => {
      sessionReads += 1;
      return { data: { user: { id: sessionReads === 1 ? USER_A : USER_B } }, error: null };
    },
    repository: { async writeDailyEntry() { writes += 1; return pending.promise; } },
  });
  pending.resolve({ data: { value: 2500 }, error: null });
  const resolved = await changedDuringWritePromise;
  assert.equal(resolved.error.code, "AUTHENTICATION_CHANGED");
  assert.equal(resolved.data, null);
  assert.equal(writes, 1);
});

test("repeated saves target the same ritual/date identity", async () => {
  const identities = [];
  const repository = { async writeDailyEntry(date, ritual) {
    identities.push(`${date}:${ritual}`);
    return { data: { completed: false, value: identities.length, completedAt: null }, error: null };
  } };
  for (const value of [1000, 2000]) {
    const result = await saveDailyRitualEntry({
      expectedUserId: USER_A, expectedProgramId: PROGRAM_A, dateISO: DATE,
      ritualId: "steps", entry: { completed: false, value }, getSession: auth(USER_A), repository,
    });
    assert.equal(result.error, null);
  }
  assert.deepEqual(identities, [`${DATE}:steps`, `${DATE}:steps`]);
});

test("confirmed cloud entry updates Today, History, Journey and analysis readers", async () => {
  const progress = {
    version: 1, startDate: DATE, entries: {}, customHabits: [], ritualSnapshots: {},
    weeklyReflections: {}, monthlyReflections: {},
  };
  const controller = createAccountDataController({
    loadProgress: async () => ({ status: "loaded", userId: USER_A, programId: PROGRAM_A, progress, error: null }),
  });
  await controller.setAccount({ userId: USER_A });
  assert.equal(controller.applyDailyEntry({
    userId: USER_A, programId: PROGRAM_A, dateISO: DATE, ritualId: "steps",
    entry: { completed: false, value: 5000, completedAt: null, applicationTimes: [] },
  }), true);

  const cloudProgress = controller.getState().progress;
  const today = createTodayCloudModel(cloudProgress, new Date(`${DATE}T12:00:00`));
  assert.equal(today.entries.steps.value, 5000);
  const history = getDaySnapshotFromProgress(cloudProgress, DATE);
  assert.equal(history.rows.find(({ ritual }) => ritual.id === "steps").entry.value, 5000);
  const daily = getDailyAnalysisFromProgress(cloudProgress, DATE);
  assert.equal(daily.snapshot.rows.find(({ ritual }) => ritual.id === "steps").status.inProgress, true);
  const weekly = getWeeklyCheckinFromProgress(cloudProgress, DATE, DATE);
  assert.equal(weekly.patterns.find(({ ritual }) => ritual.id === "steps").partialDays, 1);
  const monthly = getMonthlyAnalysisFromProgress(cloudProgress, getMonthKey(new Date(`${DATE}T12:00:00`)), DATE);
  assert.equal(monthly.habits.find(({ ritual }) => ritual.id === "steps").averageValue, 5000);
});

test("an old account write cannot update the newly selected account state", async () => {
  const controller = createAccountDataController({
    loadProgress: async ({ expectedUserId }) => ({
      status: "loaded", userId: expectedUserId, programId: `program-${expectedUserId}`,
      progress: { entries: {}, account: expectedUserId }, error: null,
    }),
  });
  await controller.setAccount({ userId: USER_A });
  await controller.setAccount({ userId: USER_B });
  assert.equal(controller.applyDailyEntry({
    userId: USER_A, programId: `program-${USER_A}`, dateISO: DATE,
    ritualId: "wake", entry: { completed: true },
  }), false);
  assert.equal(controller.getState().progress.account, USER_B);
});
