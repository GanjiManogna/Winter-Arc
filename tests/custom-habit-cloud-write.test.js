import assert from "node:assert/strict";
import test from "node:test";
import { createAccountDataController } from "../src/data/accountDataController.js";
import { archiveCustomHabitToCloud, saveCustomHabitToCloud, updateCustomHabitInCloud } from "../src/data/customHabitWriteService.js";
import { archiveCustomHabit, createCustomHabit, createCustomHabitRecord, customHabitToRitual, getAllRituals, getDaySnapshotFromProgress, loadProgress, saveProgress, setProgressAccountScope, toISODate, updateCustomHabitDefinition } from "../src/data/storage.js";
import { createTodayCloudModel } from "../src/data/todayCloudModel.js";
import { getDailyAnalysisFromProgress } from "../src/data/dailyAnalysis.js";
import { getWeeklyCheckinFromProgress } from "../src/data/weeklyAnalysis.js";
import { getMonthlyAnalysisFromProgress, getMonthKey } from "../src/data/monthlyAnalysis.js";
import { getRitualStatus } from "../src/data/ritualStatus.js";
import { saveDailyRitualEntry } from "../src/data/dailyRitualWriteService.js";

const USER_A = "user-a";
const USER_B = "user-b";
const PROGRAM_A = "program-a";
const DATE = toISODate();
const baseHabit = (overrides = {}) => createCustomHabitRecord({
  id: "custom-stretch", title: "Stretch", type: "boolean", createdAt: `${DATE}T08:00:00.000Z`, order: 0,
  ...overrides,
});
const auth = (id = USER_A) => async () => ({ data: { user: { id } }, error: null });
const successRepository = (calls = []) => ({
  async writeCustomHabit(habit, owner) { calls.push(["habit", habit, owner]); return { data: habit, error: null }; },
  async writeCustomHabitDefinition(id, definition, owner) { calls.push(["definition", id, definition, owner]); return { data: definition, error: null }; },
  async writeRitualSnapshots(date, snapshot, owner) { calls.push(["snapshot", date, snapshot, owner]); return { data: snapshot, error: null }; },
});

test("signed-out custom habit creation retains the existing local persistence path", () => {
  const previous = globalThis.localStorage;
  const previousWindow = globalThis.window;
  const stored = new Map();
  globalThis.window = { dispatchEvent() {} };
  globalThis.localStorage = {
    getItem(key) { return stored.get(key) ?? null; },
    setItem(key, value) { stored.set(key, value); },
  };
  try {
    const ritual = createCustomHabit({ title: "Local stretch", type: "boolean" });
    assert.equal(ritual.title, "Local stretch");
    assert.equal(JSON.parse([...stored.values()][0]).customHabits[0].title, "Local stretch");
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("local custom habit archive hides it from active rituals and preserves entries and date snapshots", () => {
  const previous = globalThis.localStorage;
  const previousWindow = globalThis.window;
  const stored = new Map();
  globalThis.window = { dispatchEvent() {} };
  globalThis.localStorage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)) };
  setProgressAccountScope(USER_A);
  const habit = baseHabit({ id: "custom-read", title: "Read together" });
  const snapshot = [{ ...customHabitToRitual(habit) }];
  try {
    saveProgress({ startDate: DATE, entries: { [DATE]: { [habit.id]: { completed: true, value: null } } },
      customHabits: [habit], ritualSnapshots: { [DATE]: snapshot }, weeklyReflections: {}, monthlyReflections: {} });
    assert.ok(getAllRituals().some((item) => item.id === habit.id));
    assert.equal(archiveCustomHabit(habit.id).archived, true);
    const progress = loadProgress();
    assert.equal(getAllRituals().some((item) => item.id === habit.id), false);
    assert.equal(progress.entries[DATE][habit.id].completed, true);
    assert.deepEqual(progress.ritualSnapshots[DATE], snapshot);
    assert.equal(getDaySnapshotFromProgress(progress, DATE).rows.find(({ ritual }) => ritual.id === habit.id).ritual.title, habit.title);
  } finally {
    setProgressAccountScope(null);
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("local custom habit edits change the active definition without rewriting historical snapshots", () => {
  const previous = globalThis.localStorage;
  const previousWindow = globalThis.window;
  const stored = new Map();
  globalThis.window = { dispatchEvent() {} };
  globalThis.localStorage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)) };
  setProgressAccountScope(USER_A);
  const habit = baseHabit({ id: "custom-edit", title: "Original name" });
  const snapshot = [customHabitToRitual(habit)];
  try {
    saveProgress({ startDate: DATE, entries: { [DATE]: { [habit.id]: { completed: true } } },
      customHabits: [habit], ritualSnapshots: { [DATE]: snapshot }, weeklyReflections: {}, monthlyReflections: {} });
    const updated = updateCustomHabitDefinition(habit.id, { title: "New name", type: "measurable", goal: 12, unit: "pages" });
    const progress = loadProgress();
    assert.equal(updated.title, "New name");
    assert.equal(updated.goal, 12);
    assert.equal(progress.ritualSnapshots[DATE][0].title, "Original name");
    assert.equal(progress.entries[DATE][habit.id].completed, true);
  } finally {
    setProgressAccountScope(null);
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("cloud creation writes habit, date-effective definition and full daily snapshot with stable identity", async () => {
  const calls = [];
  const habit = baseHabit({ type: "measurable", unit: "minutes", goal: 20, theme: "clarity", archived: false, order: 3 });
  const snapshot = [{ id: "wake" }, { id: "custom-old", source: "custom", title: "Old custom" }];
  const result = await saveCustomHabitToCloud({
    expectedUserId: USER_A, expectedProgramId: PROGRAM_A, habit, definitionId: "definition-stable",
    ritualSnapshot: snapshot, dateISO: DATE, getSession: auth(), repository: successRepository(calls),
  });
  assert.equal(result.error, null);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0][2], { userId: USER_A, programId: PROGRAM_A });
  assert.equal(calls[1][2].version, 1);
  assert.equal(calls[1][2].effectiveFrom, habit.createdAt);
  assert.equal(calls[1][2].goal, 20);
  assert.equal(calls[1][2].theme, "clarity");
  assert.deepEqual(result.data.ritualSnapshot.map((item) => item.id), ["wake", "custom-old", habit.id]);
  assert.equal(calls[2][1], DATE);
});

test("cloud create never reads/writes localStorage or invokes local saveProgress", async () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw Error("unexpected local read"); }, setItem() { throw Error("unexpected local write"); } };
  try {
    const result = await saveCustomHabitToCloud({
      expectedUserId: USER_A, expectedProgramId: PROGRAM_A, habit: baseHabit(), definitionId: "definition-1",
      ritualSnapshot: [{ id: "wake" }], getSession: auth(), repository: successRepository(),
    });
    assert.equal(result.error, null);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("cloud custom habit archive checks the authenticated owner and preserves cloud history", async () => {
  const habit = { ...baseHabit({ id: "custom-archive" }), archived: false, revision: 3 };
  let archivedRequest;
  const repository = {
    async archiveCustomHabit(value, owner) {
      archivedRequest = { value, owner };
      return { data: { ...value, archived: true, revision: 4 }, error: null };
    },
  };
  const wrongAccount = await archiveCustomHabitToCloud({ expectedUserId: USER_A, expectedProgramId: PROGRAM_A,
    habit, getSession: auth(USER_B), repository });
  assert.equal(wrongAccount.error.code, "AUTHENTICATION_CHANGED");
  assert.equal(archivedRequest, undefined);
  const result = await archiveCustomHabitToCloud({ expectedUserId: USER_A, expectedProgramId: PROGRAM_A,
    habit, getSession: auth(USER_A), repository });
  assert.equal(result.error, null);
  assert.equal(result.data.archived, true);
  assert.equal(archivedRequest.owner.userId, USER_A);
  assert.equal(archivedRequest.owner.programId, PROGRAM_A);
});

test("cloud custom habit edit writes a new owner-scoped definition revision", async () => {
  const habit = { ...baseHabit({ id: "custom-edit", title: "Old name" }), revision: 5, definitionRevision: 2 };
  let written;
  const result = await updateCustomHabitInCloud({
    expectedUserId: USER_A,
    expectedProgramId: PROGRAM_A,
    habit,
    definitionId: "definition-v3",
    changes: { title: "New name", type: "measurable", goal: 12, unit: "pages" },
    getSession: auth(USER_A),
    repository: {
      async writeCustomHabit(value, owner) { written = { value, owner }; return { data: { ...value, revision: 5 }, error: null }; },
      async writeCustomHabitDefinition(id, definition, owner, expectedRevision) {
        written.definition = { id, definition, owner, expectedRevision };
        return { data: { ...definition, revision: 3 }, error: null };
      },
    },
  });
  assert.equal(result.error, null);
  assert.equal(result.data.title, "New name");
  assert.equal(result.data.definitionRevision, 3);
  assert.equal(written.owner.userId, USER_A);
  assert.equal(written.definition.definition.version, 3);
  assert.equal(written.definition.expectedRevision, 2);
});

test("wrong or switched authenticated user cannot begin or complete a custom-habit create", async () => {
  let calls = 0;
  const repository = successRepository();
  const wrapped = Object.fromEntries(Object.entries(repository).map(([key, fn]) => [key, async (...args) => { calls += 1; return fn(...args); }]));
  const request = { expectedUserId: USER_A, expectedProgramId: PROGRAM_A, habit: baseHabit(), definitionId: "def", ritualSnapshot: [], repository: wrapped };
  const wrong = await saveCustomHabitToCloud({ ...request, getSession: auth(USER_B) });
  assert.equal(wrong.error.code, "AUTHENTICATION_CHANGED");
  assert.equal(calls, 0);

  let reads = 0;
  const changed = await saveCustomHabitToCloud({
    ...request,
    getSession: async () => ({ data: { user: { id: ++reads === 1 ? USER_A : USER_B } }, error: null }),
  });
  assert.equal(changed.error.code, "AUTHENTICATION_CHANGED");
});

test("failed creation returns calm failure and does not silently fall back to local persistence", async () => {
  let writes = 0;
  const result = await saveCustomHabitToCloud({
    expectedUserId: USER_A, expectedProgramId: PROGRAM_A, habit: baseHabit(), definitionId: "def",
    ritualSnapshot: [], getSession: auth(), repository: {
      async writeCustomHabit() { writes += 1; return { data: null, error: { code: "CLOUD_NETWORK_ERROR" } }; },
    },
  });
  assert.equal(result.data, null);
  assert.equal(result.error.code, "NETWORK_UNAVAILABLE");
  assert.equal(writes, 1);
});

test("retry uses the same habit and definition identity and the repository upserts stable keys", async () => {
  const identities = [];
  let failSnapshot = true;
  const repository = {
    async writeCustomHabit(habit) { identities.push(`habit:${habit.id}:${habit.cloudId}`); return { data: habit, error: null }; },
    async writeCustomHabitDefinition(id, definition) { identities.push(`definition:${id}:${definition.id}:${definition.version}`); return { data: definition, error: null }; },
    async writeRitualSnapshots(date, snapshot) {
      identities.push(`snapshot:${date}:${snapshot.map((x) => x.id).join(",")}`);
      if (failSnapshot) { failSnapshot = false; return { data: null, error: { code: "CLOUD_REQUEST_FAILED" } }; }
      return { data: snapshot, error: null };
    },
  };
  const request = { expectedUserId: USER_A, expectedProgramId: PROGRAM_A,
    habit: { ...baseHabit(), cloudId: "stable-cloud-id" }, definitionId: "stable-definition-id",
    ritualSnapshot: [{ id: "wake" }], dateISO: DATE, getSession: auth(), repository };
  assert.ok((await saveCustomHabitToCloud(request)).error);
  assert.equal((await saveCustomHabitToCloud(request)).error, null);
  assert.equal(identities[0], identities[3]);
  assert.equal(identities[1], identities[4]);
});

test("boolean and measurable custom entries retain existing status and target semantics", () => {
  const boolean = customHabitToRitual(baseHabit());
  assert.equal(getRitualStatus(boolean, { completed: false }).completed, false);
  assert.equal(getRitualStatus(boolean, { completed: true }).completed, true);
  const measurable = customHabitToRitual(baseHabit({ type: "measurable", goal: 20, unit: "minutes" }));
  assert.equal(getRitualStatus(measurable, { value: 8 }).inProgress, true);
  assert.equal(getRitualStatus(measurable, { value: 8 }).completed, false);
  assert.equal(getRitualStatus(measurable, { value: 20 }).completed, true);
});

test("custom boolean and measurable daily entries go through the authenticated cloud writer", async () => {
  for (const entry of [
    { completed: true, value: null, completedAt: "2026-10-02T09:00:00Z", applicationTimes: [] },
    { completed: false, value: 7, completedAt: null, applicationTimes: [] },
  ]) {
    let written;
    const result = await saveDailyRitualEntry({
      expectedUserId: USER_A, expectedProgramId: PROGRAM_A, dateISO: DATE,
      ritualId: "custom-stretch", entry: { ...entry, customHabitId: "custom-stretch" }, getSession: auth(),
      repository: { async writeDailyEntry(date, id, value, owner) { written = { date, id, value, owner }; return { data: value, error: null }; } },
    });
    assert.equal(result.error, null);
    assert.equal(written.value.customHabitId, "custom-stretch");
    assert.equal(written.owner.userId, USER_A);
    assert.equal(written.date, DATE);
  }
});

test("controller accepts confirmed custom data only for the matching loaded account and program", async () => {
  const progress = { startDate: DATE, entries: {}, customHabits: [], ritualSnapshots: {}, weeklyReflections: {}, monthlyReflections: {} };
  const controller = createAccountDataController({ loadProgress: async () => ({ status: "loaded", programId: PROGRAM_A, progress, error: null }) });
  await controller.setAccount({ userId: USER_A });
  const habit = baseHabit();
  assert.equal(controller.applyCustomHabit({ userId: USER_B, programId: PROGRAM_A, dateISO: DATE, habit, ritualSnapshot: [customHabitToRitual(habit)] }), false);
  assert.equal(controller.applyCustomHabit({ userId: USER_A, programId: "wrong-program", dateISO: DATE, habit, ritualSnapshot: [customHabitToRitual(habit)] }), false);
  assert.equal(controller.applyCustomHabit({ userId: USER_A, programId: PROGRAM_A, dateISO: DATE, habit, ritualSnapshot: [customHabitToRitual(habit)] }), true);
  assert.equal(controller.getState().progress.customHabits[0].id, habit.id);
});

test("account switching clears previously confirmed custom-habit state", async () => {
  const controller = createAccountDataController({ loadProgress: async ({ expectedUserId }) => ({
    status: "loaded", programId: `program-${expectedUserId}`, error: null,
    progress: { entries: {}, customHabits: expectedUserId === USER_A ? [baseHabit()] : [], ritualSnapshots: {} },
  }) });
  await controller.setAccount({ userId: USER_A });
  assert.equal(controller.getState().progress.customHabits.length, 1);
  await controller.setAccount({ userId: USER_B });
  assert.equal(controller.getState().progress.customHabits.length, 0);
});

test("confirmed custom progress feeds Today, History, Journey and existing analysis readers", async () => {
  const habit = baseHabit({ type: "measurable", unit: "pages", goal: 10 });
  const ritual = customHabitToRitual(habit);
  const progress = { startDate: DATE, entries: { [DATE]: { [habit.id]: { value: 4, completed: false } } },
    customHabits: [habit], ritualSnapshots: { [DATE]: [ritual] }, weeklyReflections: {}, monthlyReflections: {} };
  const today = createTodayCloudModel(progress, new Date(`${DATE}T12:00:00`));
  assert.equal(today.entries[habit.id].value, 4);
  const history = getDaySnapshotFromProgress(progress, DATE);
  assert.equal(history.rows.find(({ ritual: item }) => item.id === habit.id).entry.value, 4);
  assert.equal(getDailyAnalysisFromProgress(progress, DATE).snapshot.rows.some(({ ritual: item }) => item.id === habit.id), true);
  assert.equal(getWeeklyCheckinFromProgress(progress, DATE, DATE).patterns.some(({ ritual: item }) => item.id === habit.id), true);
  assert.equal(getMonthlyAnalysisFromProgress(progress, getMonthKey(new Date(`${DATE}T12:00:00`)), DATE).habits.some(({ ritual: item }) => item.id === habit.id), true);
});

test("historical snapshot keeps the definition that applied on that date, including archived habits", () => {
  const archived = { ...baseHabit({ title: "Old name", archived: true }), id: "custom-archived" };
  const historical = customHabitToRitual(archived);
  const progress = { startDate: DATE, entries: { [DATE]: { [archived.id]: { completed: true } } },
    customHabits: [{ ...archived, title: "New name", archived: true }], ritualSnapshots: { [DATE]: [historical] } };
  const history = getDaySnapshotFromProgress(progress, DATE);
  const row = history.rows.find(({ ritual }) => ritual.id === archived.id);
  assert.equal(row.ritual.title, "Old name");
  assert.equal(row.entry.completed, true);
});
