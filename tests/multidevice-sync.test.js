import assert from "node:assert/strict";
import test from "node:test";
import { createAccountDataController } from "../src/data/accountDataController.js";
import { saveDailyRitualEntry } from "../src/data/dailyRitualWriteService.js";

const USER = "shared-account";
const PROGRAM = "shared-program";
const DATE = "2026-10-02";

function sharedCloud(initialEntry) {
  let entry = { ...initialEntry };
  let reloads = 0;
  return {
    get entry() { return { ...entry }; },
    get reloads() { return reloads; },
    async loadProgress({ expectedUserId }) {
      reloads += 1;
      return {
        status: "loaded", userId: expectedUserId, programId: PROGRAM, error: null,
        progress: { startDate: DATE, entries: { [DATE]: { water: { ...entry } } }, customHabits: [], ritualSnapshots: { [DATE]: [{ id: "wake" }] }, weeklyReflections: {}, monthlyReflections: {} },
      };
    },
    async writeDailyEntry(dateISO, ritualId, next, owner, expectedRevision) {
      assert.deepEqual(owner, { userId: USER, programId: PROGRAM });
      if (dateISO !== DATE || ritualId !== "water" || expectedRevision !== entry.revision) {
        return { data: null, error: { code: "CLOUD_CONFLICT" } };
      }
      entry = { completed: Boolean(next.completed), value: next.value, completedAt: next.completedAt ?? null,
        applicationTimes: [...(next.applicationTimes || [])], revision: entry.revision + 1 };
      return { data: { date: dateISO, ritualId, ...entry }, error: null };
    },
  };
}

function session() { return async () => ({ data: { user: { id: USER } }, error: null }); }

test("a save on one device is visible after another device refreshes cloud state", async () => {
  const cloud = sharedCloud({ completed: false, value: 3, completedAt: null, applicationTimes: [], revision: 1 });
  const deviceA = createAccountDataController({ loadProgress: cloud.loadProgress });
  const deviceB = createAccountDataController({ loadProgress: cloud.loadProgress });
  await deviceA.setAccount({ userId: USER });
  await deviceB.setAccount({ userId: USER });

  const write = await saveDailyRitualEntry({ expectedUserId: USER, expectedProgramId: PROGRAM, dateISO: DATE,
    ritualId: "water", entry: { ...deviceA.getState().progress.entries[DATE].water, value: 5 },
    getSession: session(), repository: cloud });
  assert.equal(write.error, null);
  assert.equal(deviceA.applyDailyEntry({ userId: USER, programId: PROGRAM, dateISO: DATE, ritualId: "water", entry: write.data }), true);

  const before = deviceB.getState().progress.entries[DATE].water.value;
  assert.equal(before, 3);
  await deviceB.refresh(USER);
  assert.equal(deviceB.getState().progress.entries[DATE].water.value, 5);
  assert.equal(deviceB.getState().progress.entries[DATE].water.revision, 2);
});

test("stale device write is rejected, reloads latest cloud value and cannot overwrite it", async () => {
  const cloud = sharedCloud({ completed: false, value: 3, completedAt: null, applicationTimes: [], revision: 1 });
  const deviceA = createAccountDataController({ loadProgress: cloud.loadProgress });
  const deviceB = createAccountDataController({ loadProgress: cloud.loadProgress });
  await deviceA.setAccount({ userId: USER });
  await deviceB.setAccount({ userId: USER });

  const deviceBWrite = await saveDailyRitualEntry({ expectedUserId: USER, expectedProgramId: PROGRAM, dateISO: DATE,
    ritualId: "water", entry: { ...deviceB.getState().progress.entries[DATE].water, value: 5 },
    getSession: session(), repository: cloud });
  assert.equal(deviceBWrite.error, null);

  const staleWrite = await saveDailyRitualEntry({ expectedUserId: USER, expectedProgramId: PROGRAM, dateISO: DATE,
    ritualId: "water", entry: { ...deviceA.getState().progress.entries[DATE].water, value: 4 },
    getSession: session(), repository: cloud });
  assert.equal(staleWrite.data, null);
  assert.equal(staleWrite.error.code, "CONFLICT");
  assert.match(staleWrite.error.message, /Newer progress/);
  await deviceA.refresh(USER);
  assert.equal(deviceA.getState().progress.entries[DATE].water.value, 5);
  assert.equal(cloud.entry.value, 5);
});

test("refreshes from a prior account cannot replace the currently selected account", async () => {
  let resolveA;
  const controller = createAccountDataController({ loadProgress: ({ expectedUserId }) => {
    if (expectedUserId === "user-a") return new Promise((resolve) => { resolveA = resolve; });
    return Promise.resolve({ status: "loaded", userId: "user-b", programId: "program-b", progress: { account: "B", entries: {} }, error: null });
  } });
  const loadingA = controller.setAccount({ userId: "user-a" });
  await controller.setAccount({ userId: "user-b" });
  resolveA({ status: "loaded", userId: "user-a", programId: "program-a", progress: { account: "A", entries: {} }, error: null });
  await loadingA;
  assert.equal(controller.getState().userId, "user-b");
  assert.equal(controller.getState().progress.account, "B");
});

test("a background refresh cannot replace a newer confirmed write in the same account", async () => {
  let refreshResolve;
  let loads = 0;
  const controller = createAccountDataController({ loadProgress: async () => {
    loads += 1;
    if (loads === 1) return { status: "loaded", userId: USER, programId: PROGRAM,
      progress: { entries: { [DATE]: { water: { value: 3, revision: 1 } } }, customHabits: [], ritualSnapshots: {} }, error: null };
    return new Promise((resolve) => { refreshResolve = resolve; });
  } });
  await controller.setAccount({ userId: USER });
  const refresh = controller.refresh(USER);
  assert.equal(controller.applyDailyEntry({ userId: USER, programId: PROGRAM, dateISO: DATE, ritualId: "water",
    entry: { value: 5, revision: 2 } }), true);
  refreshResolve({ status: "loaded", userId: USER, programId: PROGRAM,
    progress: { entries: { [DATE]: { water: { value: 3, revision: 1 } } }, customHabits: [], ritualSnapshots: {} }, error: null });
  await refresh;
  assert.equal(controller.getState().progress.entries[DATE].water.value, 5);
});
