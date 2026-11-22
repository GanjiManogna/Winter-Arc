import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_CLIENT_KEY_ENV, createCloudRepository } from "../src/data/cloud/cloudRepository.js";
import { createRepository, defaultRepository } from "../src/data/repositories/repositoryFactory.js";
import { localRepository } from "../src/data/repositories/localRepository.js";
import { hasRepositoryContract, REPOSITORY_OPERATIONS } from "../src/data/repositories/repositoryContract.js";
import { PROGRESS_STORAGE_KEY } from "../src/data/storage.js";

const USER_ID = "2d63ce9a-a14f-4d1e-b92c-c826264bf1b2";
const PROGRAM = {
  id: "42a40a01-f8d8-4415-8dad-32f1db2ae573",
  user_id: USER_ID,
  start_date: "2026-01-01",
  source_schema_version: 1,
  created_at: "2026-01-01T00:00:00.000Z",
};

function withBrowserStorage(callback, source) {
  const oldStorage = globalThis.localStorage;
  const oldWindow = globalThis.window;
  const items = new Map([[PROGRESS_STORAGE_KEY, JSON.stringify(source)]]);
  let writes = 0;
  globalThis.localStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { writes += 1; items.set(key, String(value)); },
  };
  globalThis.window = { dispatchEvent() {} };
  return Promise.resolve(callback({ items, get writes() { return writes; } })).finally(() => {
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
  });
}

function fakeSupabase({ customHabit = null, customDefinition = null, snapshots = [], zeroUpdate = false } = {}) {
  const calls = [];
  const writes = [];
  const client = {
    auth: { async getUser() { calls.push(["auth.getUser"]); return { data: { user: { id: USER_ID } }, error: null }; } },
    from(table) {
      const query = { table, payload: null, single: false, method: null };
      const chain = (method, ...args) => { calls.push([table, method, ...args]); return builder; };
      const builder = {
        select: (...args) => chain("select", ...args),
        eq: (...args) => chain("eq", ...args),
        order: (...args) => chain("order", ...args),
        in: (...args) => chain("in", ...args),
        limit: (...args) => chain("limit", ...args),
        maybeSingle: () => { query.single = true; return builder; },
        single: () => { query.single = true; return builder; },
        upsert: (payload, options) => { query.payload = payload; writes.push({ table, payload, options }); calls.push([table, "upsert", options]); return builder; },
        insert: (payload) => { query.payload = payload; query.method = "insert"; writes.push({ table, payload, method: "insert" }); calls.push([table, "insert"]); return builder; },
        update: (payload) => { query.payload = payload; query.method = "update"; writes.push({ table, payload, method: "update" }); calls.push([table, "update"]); return builder; },
        then(resolve, reject) {
          const data = query.method === "update" && zeroUpdate ? null
            : query.method === "update" && table === "custom_habits" && customHabit
              ? { ...customHabit, ...query.payload }
              : query.payload
            ? query.payload
            : table === "arc_programs" ? [PROGRAM]
              : table === "custom_habits" ? (query.single ? customHabit : customHabit ? [customHabit] : [])
                : table === "custom_habit_definitions" ? (query.single ? customDefinition : customDefinition ? [customDefinition] : [])
                  : table === "ritual_snapshots" ? snapshots
                : [];
          return Promise.resolve({ data: query.single && Array.isArray(data) ? data[0] : data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { client, calls, writes };
}

test("local repository reads existing progress without rewriting storage", async () => {
  const state = {
    version: 1, startDate: "2026-01-01",
    entries: { "2026-01-02": { wake: { completed: true, value: null, completedAt: "2026-01-02T05:00:00.000Z" } } },
    customHabits: [], ritualSnapshots: {}, weeklyReflections: {}, monthlyReflections: {},
  };
  await withBrowserStorage(async ({ writes }) => {
    const metadata = await localRepository.getProgramMetadata();
    const entries = await localRepository.readDailyEntries("2026-01-02");
    assert.equal(metadata.data.startDate, state.startDate);
    assert.deepEqual(entries.data.map(({ date, ritualId, completed }) => [date, ritualId, completed]), [["2026-01-02", "wake", true]]);
    assert.equal(writes, 0);
  }, state);
});

test("local repository writes through the existing storage behavior and preserves its schema", async () => {
  const state = {
    version: 1, startDate: "2026-01-01", entries: {}, customHabits: [],
    ritualSnapshots: {}, weeklyReflections: {}, monthlyReflections: {},
  };
  await withBrowserStorage(async ({ items }) => {
    const result = await localRepository.writeDailyEntry("2026-01-02", "water", { value: 8 });
    const persisted = JSON.parse(items.get(PROGRESS_STORAGE_KEY));
    assert.equal(result.error, null);
    assert.equal(result.data.completed, true);
    assert.deepEqual(Object.keys(persisted).sort(), ["customHabits", "entries", "monthlyReflections", "ritualSnapshots", "startDate", "version", "weeklyReflections"]);
    assert.equal(persisted.entries["2026-01-02"].water.value, 8);
    assert.equal(persisted.entries["2026-01-02"].water.completed, true);
  }, state);
});

test("local and cloud repositories persist explicit sleep/wake times on their existing daily entries", async () => {
  const state = {
    version: 1, startDate: "2026-01-01", entries: {}, customHabits: [],
    ritualSnapshots: {}, weeklyReflections: {}, monthlyReflections: {},
  };
  await withBrowserStorage(async ({ items }) => {
    const sleep = await localRepository.writeDailyEntry("2026-01-02", "sleep", {
      completed: true, completedAt: "2026-01-02T16:48:00.000Z", sleepTime: "22:48",
    });
    const wake = await localRepository.writeDailyEntry("2026-01-03", "wake", {
      completed: true, completedAt: "2026-01-03T01:32:00.000Z", wakeTime: "06:32",
    });
    const persisted = JSON.parse(items.get(PROGRESS_STORAGE_KEY));
    assert.equal(sleep.data.sleepTime, "22:48");
    assert.equal(wake.data.wakeTime, "06:32");
    assert.equal(persisted.entries["2026-01-02"].sleep.completedAt, "2026-01-02T16:48:00.000Z");
    assert.equal(persisted.entries["2026-01-03"].wake.completedAt, "2026-01-03T01:32:00.000Z");
  }, state);

  const { client, writes } = fakeSupabase();
  const cloud = createCloudRepository({ client });
  const cloudSleep = await cloud.writeDailyEntry("2026-01-02", "sleep", {
    completed: true, completedAt: "2026-01-02T16:48:00.000Z", sleepTime: "22:48",
  });
  const cloudWake = await cloud.writeDailyEntry("2026-01-03", "wake", {
    completed: true, completedAt: "2026-01-03T01:32:00.000Z", wakeTime: "06:32",
  });
  assert.equal(writes[0].payload.sleep_time, "22:48");
  assert.equal(writes[0].payload.completed_at, "2026-01-02T16:48:00.000Z");
  assert.equal(cloudSleep.data.sleepTime, "22:48");
  assert.equal(writes[1].payload.wake_time, "06:32");
  assert.equal(writes[1].payload.completed_at, "2026-01-03T01:32:00.000Z");
  assert.equal(cloudWake.data.wakeTime, "06:32");
});

test("local and cloud repositories implement the same contract; factory defaults to local explicitly", async () => {
  const { client } = fakeSupabase();
  const cloud = createCloudRepository({ client });
  assert.ok(hasRepositoryContract(localRepository));
  assert.ok(hasRepositoryContract(cloud));
  assert.equal(defaultRepository, localRepository);
  assert.equal(createRepository(), localRepository);
  assert.ok(hasRepositoryContract(createRepository({ mode: "cloud" })));
  assert.equal(REPOSITORY_OPERATIONS.includes("writeDailyEntry"), true);
});

test("cloud repository takes ownership from authenticated Supabase identity and scopes writes", async () => {
  const { client, calls, writes } = fakeSupabase();
  const cloud = createCloudRepository({ client });
  const result = await cloud.writeDailyEntry("2026-01-02", "wake", {
    completed: true, value: null, completedAt: "2026-01-02T05:00:00.000Z", applicationTimes: [],
  });
  assert.equal(result.error, null);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].payload.user_id, USER_ID);
  assert.equal(writes[0].payload.program_id, PROGRAM.id);
  assert.ok(calls.some((call) => call[0] === "arc_programs" && call[1] === "eq" && call[2] === "user_id" && call[3] === USER_ID));
  assert.ok(calls.some((call) => call[0] === "daily_ritual_entries" && call[1] === "insert"));
});

test("cloud daily writes honor the displayed program and preserve all daily entry fields", async () => {
  const { client, calls, writes } = fakeSupabase();
  const cloud = createCloudRepository({ client });
  const applicationTimes = ["2026-01-02T08:00:00.000Z", "2026-01-02T11:00:00.000Z"];
  const result = await cloud.writeDailyEntry("2026-01-02", "sunscreen", {
    completed: true,
    value: null,
    completedAt: applicationTimes[0],
    applicationTimes,
  }, { userId: USER_ID, programId: PROGRAM.id });

  assert.equal(result.error, null);
  assert.ok(calls.some((call) => call[0] === "arc_programs" && call[1] === "eq" && call[2] === "id" && call[3] === PROGRAM.id));
  assert.deepEqual(writes[0].payload.application_times, applicationTimes);
  assert.equal(writes[0].payload.completed, true);
  assert.equal(writes[0].payload.completed_at, applicationTimes[0]);
  assert.equal(writes[0].method, "insert");
  assert.equal(writes[0].payload.revision, 1);
  assert.equal(writes.some(({ table }) => table === "arc_programs"), false);
});

test("cloud reflection writes enforce displayed account/program and compare-and-swap existing identities", async () => {
  const { client, calls, writes } = fakeSupabase();
  const cloud = createCloudRepository({ client });
  const owner = { userId: USER_ID, programId: PROGRAM.id };
  const weekly = await cloud.writeWeeklyReflection("2026-09-28", {
    wins: "Wins", challenges: "Challenges", focus: "Focus",
  }, owner);
  const monthly = await cloud.writeMonthlyReflection("2026-10", { intention: "Intention" }, owner);
  const wrongOwner = await cloud.writeWeeklyReflection("2026-09-28", { wins: "no", challenges: "", focus: "" }, {
    userId: "another-user", programId: PROGRAM.id,
  });
  const wrongProgram = await cloud.writeMonthlyReflection("2026-10", { intention: "no" }, {
    userId: USER_ID, programId: "another-program",
  });

  assert.equal(weekly.data.wins, "Wins");
  assert.equal(weekly.data.challenges, "Challenges");
  assert.equal(weekly.data.focus, "Focus");
  assert.equal(monthly.data.month, "2026-10");
  assert.equal(monthly.data.intention, "Intention");
  assert.equal(writes.find(({ table }) => table === "weekly_reflections").method, "insert");
  assert.equal(writes.find(({ table }) => table === "weekly_reflections").payload.revision, 1);
  assert.equal(writes.find(({ table }) => table === "monthly_reflections").payload.month, "2026-10-01");
  assert.equal(writes.find(({ table }) => table === "monthly_reflections").method, "insert");
  assert.equal(writes.find(({ table }) => table === "monthly_reflections").payload.revision, 1);
  assert.equal(wrongOwner.error.code, "AUTHENTICATION_CHANGED");
  assert.equal(wrongProgram.error.code, "PROGRAM_NOT_FOUND");
  assert.equal(writes.length, 2);
  assert.equal(writes.some(({ table }) => table === "arc_programs"), false);
  assert.ok(calls.some((call) => call[0] === "arc_programs" && call[1] === "eq" && call[2] === "id" && call[3] === PROGRAM.id));
});

test("cloud custom habit, definition, snapshot and daily writes use existing owner-scoped upserts", async () => {
  const customHabit = { id: "db-custom-uuid", source_habit_id: "custom-stretch", archived: false, display_order: 2, created_at: "2026-01-02T08:00:00Z", revision: 1 };
  const { client, calls, writes } = fakeSupabase({ customHabit });
  const cloud = createCloudRepository({ client });
  const owner = { userId: USER_ID, programId: PROGRAM.id };
  const habit = { id: "custom-stretch", cloudId: customHabit.id, title: "Stretch", type: "boolean", createdAt: "2026-01-02T08:00:00Z", archived: false, order: 2 };
  const created = await cloud.writeCustomHabit(habit, owner);
  const definition = await cloud.writeCustomHabitDefinition(habit.id, {
    id: "stable-definition", version: 1, effectiveFrom: habit.createdAt, title: habit.title, type: habit.type,
    archived: false, order: 2,
  }, owner);
  const snapshots = await cloud.writeRitualSnapshots("2026-01-02", [
    { id: "wake" }, { id: habit.id, source: "custom", title: habit.title },
  ], owner);
  const daily = await cloud.writeDailyEntry("2026-01-02", habit.id, {
    customHabitId: habit.id, completed: true, value: null, completedAt: "2026-01-02T09:00:00Z", applicationTimes: [],
  }, owner);

  assert.equal(created.error, null);
  assert.equal(created.data.cloudId, customHabit.id);
  assert.equal(definition.data.id, "stable-definition");
  assert.equal(snapshots.error, null);
  assert.equal(daily.error, null);
  assert.equal(writes.some(({ table }) => table === "custom_habits"), false);
  assert.equal(writes.find(({ table }) => table === "custom_habit_definitions").payload.id, "stable-definition");
  assert.equal(writes.find(({ table }) => table === "custom_habit_definitions").method, "insert");
  assert.equal(writes.find(({ table }) => table === "ritual_snapshots").payload[1].custom_habit_id, customHabit.id);
  assert.equal(writes.find(({ table }) => table === "daily_ritual_entries").payload.custom_habit_id, customHabit.id);
  assert.equal(writes.some(({ table }) => table === "arc_programs"), false);
  assert.ok(calls.some((call) => call[0] === "arc_programs" && call[1] === "eq" && call[2] === "id" && call[3] === PROGRAM.id));
});

test("custom daily writes reject mismatched ritual ids and unowned custom habits", async () => {
  const { client, writes } = fakeSupabase();
  const cloud = createCloudRepository({ client });
  const owner = { userId: USER_ID, programId: PROGRAM.id };
  const mismatched = await cloud.writeDailyEntry("2026-01-02", "other-id", { customHabitId: "custom-stretch" }, owner);
  const missing = await cloud.writeDailyEntry("2026-01-02", "custom-stretch", { customHabitId: "custom-stretch" }, owner);
  assert.equal(mismatched.error.code, "CUSTOM_HABIT_NOT_FOUND");
  assert.equal(missing.error.code, "CUSTOM_HABIT_NOT_FOUND");
  assert.equal(writes.some(({ table }) => table === "daily_ritual_entries"), false);
});

test("ritual snapshot writes preserve existing history and reject a stale snapshot instead of replacing it", async () => {
  const ownedSnapshot = { snapshot_date: "2026-10-02", ritual_id: "wake", position: 0, definition: { id: "wake", title: "Wake" }, program_id: PROGRAM.id, user_id: USER_ID, revision: 1 };
  const owner = { userId: USER_ID, programId: PROGRAM.id };
  const stable = fakeSupabase({ snapshots: [ownedSnapshot] });
  const stableResult = await createCloudRepository({ client: stable.client }).writeRitualSnapshots("2026-10-02", [{ id: "wake", title: "Wake" }], owner);
  assert.equal(stableResult.error, null);
  assert.equal(stable.writes.some(({ table }) => table === "ritual_snapshots"), false);

  const newerSnapshot = { ...ownedSnapshot, ritual_id: "custom-from-other-device", position: 1,
    definition: { id: "custom-from-other-device", source: "custom" } };
  const concurrent = fakeSupabase({ snapshots: [ownedSnapshot, newerSnapshot] });
  const staleResult = await createCloudRepository({ client: concurrent.client }).writeRitualSnapshots("2026-10-02", [
    { id: "wake", title: "Wake" }, { id: "custom-from-this-device", source: "custom" },
  ], owner);
  assert.equal(staleResult.error.code, "CLOUD_CONFLICT");
  assert.equal(concurrent.writes.some(({ table }) => table === "ritual_snapshots"), false);
});

test("stale custom habit or definition requests cannot replace a newer definition", async () => {
  const customHabit = { id: "db-custom-uuid", source_habit_id: "custom-stretch", archived: false, display_order: 2, created_at: "2026-01-02T08:00:00Z", revision: 1 };
  const customDefinition = { id: "definition-v2", custom_habit_id: customHabit.id, version: 2, effective_from: "2026-01-03T08:00:00Z",
    title: "Updated habit", habit_type: "boolean", unit: null, goal: null, icon: "✦", theme: "clarity", short_description: "",
    archived: false, display_order: 2, revision: 2 };
  const { client, writes } = fakeSupabase({ customHabit, customDefinition });
  const cloud = createCloudRepository({ client });
  const owner = { userId: USER_ID, programId: PROGRAM.id };
  const habitConflict = await cloud.writeCustomHabit({ id: "custom-stretch", title: "Changed stale", type: "boolean", createdAt: customHabit.created_at, archived: true, order: 2 }, owner);
  const definitionConflict = await cloud.writeCustomHabitDefinition("custom-stretch", {
    id: "definition-v3", version: 3, effectiveFrom: "2026-01-04T08:00:00Z", title: "Stale title", type: "boolean", archived: false, order: 2,
  }, owner, 1);
  assert.equal(habitConflict.error.code, "CLOUD_CONFLICT");
  assert.equal(definitionConflict.error.code, "CLOUD_CONFLICT");
  assert.equal(writes.some(({ table }) => table === "custom_habits" || table === "custom_habit_definitions"), false);
});

test("custom habit archive is an owner-scoped revision update and preserves dated snapshots", async () => {
  const customHabit = { id: "db-custom-uuid", source_habit_id: "custom-stretch", archived: false,
    display_order: 2, created_at: "2026-01-02T08:00:00Z", revision: 4 };
  const { client, calls, writes } = fakeSupabase({ customHabit });
  const cloud = createCloudRepository({ client });
  const result = await cloud.archiveCustomHabit({ id: "custom-stretch", revision: 4 }, {
    userId: USER_ID, programId: PROGRAM.id,
  });
  assert.equal(result.error, null);
  assert.equal(result.data.archived, true);
  assert.equal(result.data.revision, 5);
  assert.deepEqual(writes.find(({ table }) => table === "custom_habits").payload, { archived: true, revision: 5 });
  assert.ok(calls.some((call) => call[0] === "custom_habits" && call[1] === "eq" && call[2] === "user_id" && call[3] === USER_ID));
  assert.ok(calls.some((call) => call[0] === "custom_habits" && call[1] === "eq" && call[2] === "revision" && call[3] === 4));
  assert.equal(writes.some(({ table }) => table === "daily_ritual_entries" || table === "ritual_snapshots"), false);
});

test("cloud daily writes reject another user or program before changing rows", async () => {
  const { client, writes } = fakeSupabase();
  const cloud = createCloudRepository({ client });
  const entry = { completed: true, value: null, completedAt: null, applicationTimes: [] };

  const otherUser = await cloud.writeDailyEntry("2026-01-02", "wake", entry, {
    userId: "another-user", programId: PROGRAM.id,
  });
  const otherProgram = await cloud.writeDailyEntry("2026-01-02", "wake", entry, {
    userId: USER_ID, programId: "another-program",
  });

  assert.equal(otherUser.error.code, "AUTHENTICATION_CHANGED");
  assert.equal(otherProgram.error.code, "PROGRAM_NOT_FOUND");
  assert.equal(writes.length, 0);
});

test("repeated cloud edits increment one daily revision and Sleep Tracker stays informational", async () => {
  const { client, writes } = fakeSupabase();
  const cloud = createCloudRepository({ client });
  await cloud.writeDailyEntry("2026-01-02", "steps", { completed: false, value: 2500 }, {
    userId: USER_ID, programId: PROGRAM.id,
  });
  await cloud.writeDailyEntry("2026-01-02", "steps", { completed: false, value: 5000, revision: 1 }, {
    userId: USER_ID, programId: PROGRAM.id,
  });
  const sleep = await cloud.writeDailyEntry("2026-01-02", "sleep-tracker", {
    completed: true, value: 7.5, completedAt: "2026-01-02T06:00:00Z",
  }, { userId: USER_ID, programId: PROGRAM.id });

  assert.equal(writes.length, 3);
  assert.equal(writes[0].method, "insert");
  assert.equal(writes[1].method, "update");
  assert.equal(writes[0].payload.entry_date, writes[1].payload.entry_date);
  assert.equal(writes[0].payload.ritual_id, writes[1].payload.ritual_id);
  assert.equal(writes[1].payload.revision, 2);
  assert.equal(writes[1].payload.value, 5000);
  assert.equal(writes[2].payload.record_kind, "informational");
  assert.equal(writes[2].payload.completed, false);
  assert.equal(writes[2].payload.completed_at, null);
  assert.equal(sleep.data.completed, false);
  assert.equal(sleep.data.value, 7.5);
});

test("stale daily revision is rejected instead of overwriting a newer cloud value", async () => {
  const { client, writes, calls } = fakeSupabase({ zeroUpdate: true });
  const cloud = createCloudRepository({ client });
  const result = await cloud.writeDailyEntry("2026-01-02", "water", { completed: false, value: 4 }, {
    userId: USER_ID, programId: PROGRAM.id,
  }, 1);
  assert.equal(result.data, null);
  assert.equal(result.error.code, "CLOUD_CONFLICT");
  assert.equal(writes[0].method, "update");
  assert.equal(writes[0].payload.revision, 2);
  assert.ok(calls.some((call) => call[0] === "daily_ritual_entries" && call[1] === "eq" && call[2] === "revision" && call[3] === 1));
});

test("stale weekly and monthly reflection revisions are rejected without overwriting cloud values", async () => {
  const { client, writes, calls } = fakeSupabase({ zeroUpdate: true });
  const cloud = createCloudRepository({ client });
  const owner = { userId: USER_ID, programId: PROGRAM.id };
  const weekly = await cloud.writeWeeklyReflection("2026-09-28", { wins: "stale", challenges: "", focus: "" }, owner, 4);
  const monthly = await cloud.writeMonthlyReflection("2026-10", { intention: "stale" }, owner, 7);
  assert.equal(weekly.error.code, "CLOUD_CONFLICT");
  assert.equal(monthly.error.code, "CLOUD_CONFLICT");
  assert.deepEqual(writes.map((write) => write.method), ["update", "update"]);
  assert.ok(calls.some((call) => call[0] === "weekly_reflections" && call[1] === "eq" && call[2] === "revision" && call[3] === 4));
  assert.ok(calls.some((call) => call[0] === "monthly_reflections" && call[1] === "eq" && call[2] === "revision" && call[3] === 7));
});

test("local and cloud daily-entry writes return the same normalized application shape", async () => {
  const state = {
    version: 1, startDate: "2026-01-01", entries: {}, customHabits: [],
    ritualSnapshots: {}, weeklyReflections: {}, monthlyReflections: {},
  };
  await withBrowserStorage(async () => {
    const local = await localRepository.writeDailyEntry("2026-01-02", "wake", {
      completed: true, value: null, completedAt: "2026-01-02T05:00:00.000Z", applicationTimes: [],
    });
    const { client } = fakeSupabase();
    const cloud = await createCloudRepository({ client }).writeDailyEntry("2026-01-02", "wake", {
      completed: true, value: null, completedAt: "2026-01-02T05:00:00.000Z", applicationTimes: [],
    });
    assert.equal(local.error, null);
    assert.equal(cloud.error, null);
    assert.deepEqual({ date: cloud.data.date, ritualId: cloud.data.ritualId, completed: cloud.data.completed, value: cloud.data.value, completedAt: cloud.data.completedAt, applicationTimes: cloud.data.applicationTimes }, local.data);
  }, state);
});

test("cloud repository maps application month keys to the schema's first-of-month date", async () => {
  const { client, writes } = fakeSupabase();
  const cloud = createCloudRepository({ client });
  const result = await cloud.writeMonthlyReflection("2026-07", { intention: "Rest with purpose" });
  assert.equal(result.error, null);
  assert.equal(writes[0].payload.month, "2026-07-01");
  assert.equal(result.data.month, "2026-07");
});

test("frontend cloud repository is configured only with the public anon key", () => {
  assert.equal(CLOUD_CLIENT_KEY_ENV, "VITE_SUPABASE_ANON_KEY");
});
