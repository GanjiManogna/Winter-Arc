import assert from "node:assert/strict";
import test from "node:test";
import { createAccountDataController } from "../src/data/accountDataController.js";
import { saveMonthlyReflectionToCloud, saveWeeklyReflectionToCloud } from "../src/data/reflectionWriteService.js";
import { PROGRESS_STORAGE_KEY, getMonthlyIntentionFromProgress, getWeeklyReflectionFromProgress } from "../src/data/storage.js";
import { getWeekStartIsoFromProgress } from "../src/data/weeklyAnalysis.js";
import { localRepository } from "../src/data/repositories/localRepository.js";

const USER_A = "reflection-user-a";
const USER_B = "reflection-user-b";
const PROGRAM_A = "reflection-program-a";
const WEEK = "2026-09-28";
const MONTH = "2026-10";
const auth = (userId = USER_A) => async () => ({ data: { user: { id: userId } }, error: null });

function mockRepository() {
  const weekly = new Map();
  const monthly = new Map();
  const writes = [];
  return {
    writes,
    weekly,
    monthly,
    async writeWeeklyReflection(key, value, owner) {
      writes.push({ table: "weekly", key, value, owner });
      weekly.set(`${owner.userId}:${owner.programId}:${key}`, { weekStart: key, ...value });
      return { data: weekly.get(`${owner.userId}:${owner.programId}:${key}`), error: null };
    },
    async writeMonthlyReflection(key, value, owner) {
      writes.push({ table: "monthly", key, value, owner });
      monthly.set(`${owner.userId}:${owner.programId}:${key}`, { month: key, ...value });
      return { data: monthly.get(`${owner.userId}:${owner.programId}:${key}`), error: null };
    },
  };
}

async function withStorage(callback) {
  const oldStorage = globalThis.localStorage;
  const oldWindow = globalThis.window;
  const items = new Map([[PROGRESS_STORAGE_KEY, JSON.stringify({
    version: 1, startDate: "2026-01-01", entries: {}, customHabits: [], ritualSnapshots: {},
    weeklyReflections: {}, monthlyReflections: {},
  })]]);
  globalThis.localStorage = {
    getItem(key) { return items.get(key) ?? null; },
    setItem(key, value) { items.set(key, String(value)); },
  };
  globalThis.window = { dispatchEvent() {} };
  try { return await callback(items); }
  finally {
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
  }
}

test("local weekly reflection retains Wins, Challenges and Focus in existing local model", async () => {
  await withStorage(async (items) => {
    await localRepository.writeWeeklyReflection(WEEK, { wins: "Initial", challenges: "Challenges", focus: "Focus" });
    const result = await localRepository.writeWeeklyReflection(WEEK, { wins: "Wins", challenges: "Challenges", focus: "Focus" });
    const progress = JSON.parse(items.get(PROGRESS_STORAGE_KEY));
    assert.deepEqual(result.data, { weekStart: WEEK, wins: "Wins", challenges: "Challenges", focus: "Focus" });
    assert.deepEqual(progress.weeklyReflections[WEEK], { wins: "Wins", challenges: "Challenges", focus: "Focus" });
    assert.deepEqual((await localRepository.readWeeklyReflections(WEEK)).data, [result.data]);
  });
});

test("local monthly intention retains existing localStorage behavior", async () => {
  await withStorage(async (items) => {
    await localRepository.writeMonthlyReflection(MONTH, { intention: "Initial intention" });
    const result = await localRepository.writeMonthlyReflection(MONTH, { intention: "Make room for rest" });
    assert.equal(result.data.intention, "Make room for rest");
    assert.equal(JSON.parse(items.get(PROGRESS_STORAGE_KEY)).monthlyReflections[MONTH].intention, "Make room for rest");
    assert.deepEqual((await localRepository.readMonthlyReflections(MONTH)).data, [result.data]);
  });
});

test("cloud weekly writer persists all fields under the confirmed user, program and week", async () => {
  const repository = mockRepository();
  const reflection = { wins: "Wins", challenges: "Challenges", focus: "Focus" };
  const result = await saveWeeklyReflectionToCloud({ expectedUserId: USER_A, expectedProgramId: PROGRAM_A, weekStart: WEEK, reflection, getSession: auth(), repository });
  assert.equal(result.error, null);
  assert.deepEqual(result.data, { weekStart: WEEK, ...reflection });
  assert.deepEqual(repository.writes[0], { table: "weekly", key: WEEK, value: reflection, owner: { userId: USER_A, programId: PROGRAM_A } });
});

test("cloud monthly writer persists the intention under the existing month key", async () => {
  const repository = mockRepository();
  const result = await saveMonthlyReflectionToCloud({ expectedUserId: USER_A, expectedProgramId: PROGRAM_A, month: MONTH, intention: "Make room", getSession: auth(), repository });
  assert.equal(result.error, null);
  assert.equal(result.data.month, MONTH);
  assert.equal(result.data.intention, "Make room");
  assert.equal(repository.writes[0].key, MONTH);
});

test("successful cloud reflection writes never touch localStorage", async () => {
  const previous = globalThis.localStorage;
  let calls = 0;
  globalThis.localStorage = { getItem() { calls += 1; throw Error("unexpected local read"); }, setItem() { calls += 1; throw Error("unexpected local write"); } };
  try {
    const repository = mockRepository();
    const weekly = await saveWeeklyReflectionToCloud({ expectedUserId: USER_A, expectedProgramId: PROGRAM_A, weekStart: WEEK,
      reflection: { wins: "w", challenges: "c", focus: "f" }, getSession: auth(), repository });
    const monthly = await saveMonthlyReflectionToCloud({ expectedUserId: USER_A, expectedProgramId: PROGRAM_A, month: MONTH,
      intention: "i", getSession: auth(), repository });
    assert.equal(weekly.error, null);
    assert.equal(monthly.error, null);
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("reflection service rejects the wrong account before issuing a cloud write", async () => {
  const repository = mockRepository();
  const result = await saveWeeklyReflectionToCloud({
    expectedUserId: USER_A, expectedProgramId: PROGRAM_A, weekStart: WEEK,
    reflection: { wins: "x", challenges: "y", focus: "z" }, getSession: auth(USER_B), repository,
  });
  assert.equal(result.error.code, "AUTHENTICATION_CHANGED");
  assert.equal(repository.writes.length, 0);
});

test("failed reflection writes are not reported as saved and never fall back to localStorage", async () => {
  const previous = globalThis.localStorage;
  let localReads = 0;
  let localWrites = 0;
  globalThis.localStorage = { getItem() { localReads += 1; throw Error("unexpected local read"); }, setItem() { localWrites += 1; throw Error("unexpected local write"); } };
  try {
    const result = await saveMonthlyReflectionToCloud({
      expectedUserId: USER_A, expectedProgramId: PROGRAM_A, month: MONTH, intention: "A draft", getSession: auth(),
      repository: { async writeMonthlyReflection() { return { data: null, error: { code: "CLOUD_NETWORK_ERROR" } }; } },
    });
    assert.equal(result.data, null);
    assert.equal(result.error.code, "NETWORK_UNAVAILABLE");
    assert.equal(localReads, 0);
    assert.equal(localWrites, 0);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("repeated saves update the same weekly/monthly identities and remain retry-safe", async () => {
  const repository = mockRepository();
  for (const wins of ["First", "Updated"]) {
    assert.equal((await saveWeeklyReflectionToCloud({ expectedUserId: USER_A, expectedProgramId: PROGRAM_A, weekStart: WEEK,
      reflection: { wins, challenges: "Hard", focus: "Continue" }, getSession: auth(), repository })).error, null);
  }
  for (const intention of ["First", "Updated"]) {
    assert.equal((await saveMonthlyReflectionToCloud({ expectedUserId: USER_A, expectedProgramId: PROGRAM_A, month: MONTH,
      intention, getSession: auth(), repository })).error, null);
  }
  assert.equal(repository.writes.filter((write) => write.table === "weekly" && write.key === WEEK).length, 2);
  assert.equal(repository.writes.filter((write) => write.table === "monthly" && write.key === MONTH).length, 2);
  assert.equal(repository.weekly.get(`${USER_A}:${PROGRAM_A}:${WEEK}`).wins, "Updated");
  assert.equal(repository.monthly.get(`${USER_A}:${PROGRAM_A}:${MONTH}`).intention, "Updated");
});

test("a stale User A save cannot mutate User B reflection state or request a User B reload", async () => {
  let reads = 0;
  const repository = mockRepository();
  const controller = createAccountDataController({ loadProgress: async ({ expectedUserId }) => ({
    status: "loaded", programId: `program-${expectedUserId}`, error: null,
    progress: { entries: {}, customHabits: [], ritualSnapshots: {}, weeklyReflections: {}, monthlyReflections: {} },
  }) });
  await controller.setAccount({ userId: USER_A });
  const request = saveWeeklyReflectionToCloud({
    expectedUserId: USER_A, expectedProgramId: `program-${USER_A}`, weekStart: WEEK,
    reflection: { wins: "A wins", challenges: "A challenges", focus: "A focus" },
    getSession: async () => ({ data: { user: { id: ++reads === 1 ? USER_A : USER_B } }, error: null }),
    repository,
  });
  await controller.setAccount({ userId: USER_B });
  const result = await request;
  assert.equal(result.error.code, "AUTHENTICATION_CHANGED");
  assert.equal(controller.applyWeeklyReflection({ userId: USER_A, programId: `program-${USER_A}`, weekStart: WEEK, reflection: result.data }), false);
  assert.deepEqual(controller.getState().progress.weeklyReflections, {});
  assert.equal(controller.getState().userId, USER_B);
});

test("account switching clears previous cloud reflection state", async () => {
  const controller = createAccountDataController({ loadProgress: async ({ expectedUserId }) => ({
    status: "loaded", programId: `program-${expectedUserId}`, error: null,
    progress: { entries: {}, customHabits: [], ritualSnapshots: {}, weeklyReflections: expectedUserId === USER_A ? { [WEEK]: { wins: "private" } } : {}, monthlyReflections: expectedUserId === USER_A ? { [MONTH]: { intention: "private" } } : {} },
  }) });
  await controller.setAccount({ userId: USER_A });
  assert.equal(controller.getState().progress.weeklyReflections[WEEK].wins, "private");
  await controller.setAccount({ userId: USER_B });
  assert.deepEqual(controller.getState().progress.weeklyReflections, {});
  assert.deepEqual(controller.getState().progress.monthlyReflections, {});
});

test("confirmed cloud reflections are immediately visible to analysis readers and use Winter Arc week boundaries", async () => {
  const progress = { startDate: "2026-01-07", entries: {}, customHabits: [], ritualSnapshots: {}, weeklyReflections: {}, monthlyReflections: {} };
  const controller = createAccountDataController({ loadProgress: async () => ({ status: "loaded", programId: PROGRAM_A, error: null, progress }) });
  await controller.setAccount({ userId: USER_A });
  const weekStart = getWeekStartIsoFromProgress(controller.getState().progress, "2026-01-13");
  assert.equal(weekStart, "2026-01-07");
  const weekly = { wins: "Kept returning", challenges: "Late evenings", focus: "Protect rest" };
  const monthKey = "2026-01";
  const monthly = { intention: "Move with care" };
  assert.equal(controller.applyWeeklyReflection({ userId: USER_A, programId: PROGRAM_A, weekStart, reflection: weekly }), true);
  assert.equal(controller.applyMonthlyReflection({ userId: USER_A, programId: PROGRAM_A, month: monthKey, reflection: monthly }), true);
  const confirmed = controller.getState().progress;
  assert.equal(getWeeklyReflectionFromProgress(confirmed, weekStart).wins, weekly.wins);
  assert.equal(getWeeklyReflectionFromProgress(confirmed, weekStart).challenges, weekly.challenges);
  assert.equal(getWeeklyReflectionFromProgress(confirmed, weekStart).focus, weekly.focus);
  assert.equal(getMonthlyIntentionFromProgress(confirmed, monthKey), monthly.intention);
});
