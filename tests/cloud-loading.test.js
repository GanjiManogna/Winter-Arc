import assert from "node:assert/strict";
import test from "node:test";
import { loadAccountProgress } from "../src/data/accountProgressService.js";
import { createCloudRepository } from "../src/data/cloud/cloudRepository.js";

const USER_ID = "2d63ce9a-a14f-4d1e-b92c-c826264bf1b2";
const PROGRAM_ID = "42a40a01-f8d8-4415-8dad-32f1db2ae573";
const HABIT_ID = "66f5caf7-c829-40db-a6bf-c58558705eb8";
const PROGRAM = {
  id: PROGRAM_ID,
  user_id: USER_ID,
  start_date: "2026-01-01",
  source_schema_version: 1,
};

function records() {
  const owned = { program_id: PROGRAM_ID, user_id: USER_ID };
  return {
    daily_ritual_entries: [
      { ...owned, entry_date: "2026-01-02", ritual_id: "wake", record_kind: "boolean", completed: true, value: null, completed_at: "2026-01-02T05:10:00.000Z", application_times: [] },
      { ...owned, entry_date: "2026-01-02", ritual_id: "sunscreen", record_kind: "boolean", completed: true, value: null, completed_at: "2026-01-02T08:00:00.000Z", application_times: ["2026-01-02T08:00:00.000Z", "2026-01-02T12:00:00.000Z"] },
      { ...owned, entry_date: "2026-01-02", ritual_id: "sleep-tracker", record_kind: "informational", completed: false, value: "7.5", completed_at: null, application_times: [] },
      { ...owned, entry_date: "2026-01-03", ritual_id: "custom-journal", record_kind: "measurable", completed: true, value: "25", completed_at: "2026-01-03T21:00:00.000Z", application_times: [] },
    ],
    ritual_snapshots: [
      { ...owned, snapshot_date: "2026-01-02", ritual_id: "wake", position: 0, definition: { id: "wake", title: "Wake Up Early", type: "boolean" } },
      { ...owned, snapshot_date: "2026-01-02", ritual_id: "sunscreen", position: 1, definition: { id: "sunscreen", title: "Apply Sunscreen", type: "boolean" } },
      { ...owned, snapshot_date: "2026-01-02", ritual_id: "sleep-tracker", position: 2, definition: { id: "sleep-tracker", title: "Sleep Tracker", type: "measurable", goalMin: 7, goalMax: 9 } },
      { ...owned, snapshot_date: "2026-01-03", ritual_id: "custom-journal", position: 0, definition: { id: "custom-journal", title: "Read a chapter", type: "measurable", source: "custom", unit: "pages", goal: 20 } },
    ],
    custom_habits: [
      { ...owned, id: HABIT_ID, source_habit_id: "custom-journal", archived: false, display_order: 0, created_at: "2026-01-01T08:00:00.000Z" },
    ],
    custom_habit_definitions: [
      { ...owned, custom_habit_id: HABIT_ID, version: 1, effective_from: "2026-01-01T08:00:00.000Z", title: "Read a chapter", habit_type: "measurable", unit: "pages", goal: "20", icon: "▤", theme: "knowledge", short_description: "A little learning", archived: false, display_order: 0 },
    ],
    weekly_reflections: [
      { ...owned, week_start: "2025-12-31", wins: "Kept going", challenges: "Late night", focus: "Rest" },
    ],
    monthly_reflections: [
      { ...owned, month: "2026-01-01", intention: "Move with care" },
    ],
  };
}

function mockSupabase({ programRows = [PROGRAM], tableRows = records(), failureTable = null } = {}) {
  const calls = [];
  let writes = 0;
  return {
    calls,
    get writes() { return writes; },
    client: {
      auth: { async getUser() { return { data: { user: { id: USER_ID } }, error: null }; } },
      from(table) {
        const builder = {
          select(...args) { calls.push([table, "select", ...args]); return builder; },
          eq(...args) { calls.push([table, "eq", ...args]); return builder; },
          order(...args) { calls.push([table, "order", ...args]); return builder; },
          then(resolve, reject) {
            const error = table === failureTable ? { code: "42501", message: "sensitive database response" } : null;
            const data = table === "arc_programs" ? programRows : tableRows[table] || [];
            return Promise.resolve({ data, error }).then(resolve, reject);
          },
          upsert() { writes += 1; return builder; },
        };
        calls.push([table, "from"]);
        return builder;
      },
    },
  };
}

function signedInSession() {
  return { data: { user: { id: USER_ID } }, error: null };
}

test("authenticated account loads all cloud records into the application progress model", async () => {
  const mock = mockSupabase();
  const states = [];
  const result = await loadAccountProgress({
    getSession: async () => signedInSession(),
    repository: createCloudRepository({ client: mock.client }),
    onStateChange: (state) => states.push(state.status),
  });

  assert.equal(result.status, "loaded");
  assert.deepEqual(states, ["loading", "loaded"]);
  assert.deepEqual(result.progress, {
    version: 1,
    startDate: "2026-01-01",
    entries: {
      "2026-01-02": {
        wake: { completed: true, value: null, completedAt: "2026-01-02T05:10:00.000Z", applicationTimes: [], revision: 1 },
        sunscreen: { completed: true, value: null, completedAt: "2026-01-02T08:00:00.000Z", applicationTimes: ["2026-01-02T08:00:00.000Z", "2026-01-02T12:00:00.000Z"], revision: 1 },
        "sleep-tracker": { completed: false, value: 7.5, completedAt: null, applicationTimes: [], revision: 1 },
      },
      "2026-01-03": {
        "custom-journal": { completed: true, value: 25, completedAt: "2026-01-03T21:00:00.000Z", applicationTimes: [], revision: 1 },
      },
    },
    customHabits: [{
      id: "custom-journal", title: "Read a chapter", type: "measurable", unit: "pages", goal: 20,
      icon: "▤", theme: "knowledge", shortDescription: "A little learning",
      createdAt: "2026-01-01T08:00:00.000Z", archived: false, order: 0, revision: 1, definitionRevision: 1,
    }],
    ritualSnapshots: {
      "2026-01-02": [
        { id: "wake", title: "Wake Up Early", type: "boolean" },
        { id: "sunscreen", title: "Apply Sunscreen", type: "boolean" },
        { id: "sleep-tracker", title: "Sleep Tracker", type: "measurable", goalMin: 7, goalMax: 9 },
      ],
      "2026-01-03": [
        { id: "custom-journal", title: "Read a chapter", type: "measurable", source: "custom", unit: "pages", goal: 20 },
      ],
    },
    weeklyReflections: { "2025-12-31": { wins: "Kept going", challenges: "Late night", focus: "Rest", revision: 1 } },
    monthlyReflections: { "2026-01": { intention: "Move with care", revision: 1 } },
  });
  assert.ok(["daily_ritual_entries", "ritual_snapshots", "custom_habits", "custom_habit_definitions", "weekly_reflections", "monthly_reflections"]
    .every((table) => mock.calls.some((call) => call[0] === table && call[1] === "from")));
  assert.ok(mock.calls.filter((call) => call[1] === "eq").every((call) => call[2] !== "user_id" || call[3] === USER_ID));
  assert.equal(mock.writes, 0);
});

test("signed-out users receive an unauthenticated state without cloud reads", async () => {
  let loads = 0;
  const result = await loadAccountProgress({
    getSession: async () => ({ data: { user: null }, error: null }),
    repository: { async loadProgress() { loads += 1; return { data: {} }; } },
  });
  assert.equal(result.status, "unauthenticated");
  assert.equal(loads, 0);
});

test("a session that changes identities before loading is rejected before cloud reads", async () => {
  let loads = 0;
  const result = await loadAccountProgress({
    expectedUserId: "another-user",
    getSession: async () => signedInSession(),
    repository: { async loadProgress() { loads += 1; return { data: {} }; } },
  });
  assert.equal(result.status, "cloud-load-error");
  assert.equal(result.error.code, "AUTHENTICATION_CHANGED");
  assert.equal(loads, 0);
});

test("a repository auth change after session validation becomes a recoverable cloud error", async () => {
  const result = await loadAccountProgress({
    getSession: async () => signedInSession(),
    repository: { async loadProgress() { return { data: null, error: { code: "AUTHENTICATION_REQUIRED" } }; } },
  });
  assert.equal(result.status, "cloud-load-error");
  assert.equal(result.error.code, "AUTHENTICATION_CHANGED");
  assert.doesNotMatch(result.error.message, /token|session/i);
});

test("authenticated user with no program receives an explicit no-cloud-program state", async () => {
  const mock = mockSupabase({ programRows: [] });
  const result = await loadAccountProgress({
    getSession: async () => signedInSession(),
    repository: createCloudRepository({ client: mock.client }),
  });
  assert.equal(result.status, "no-cloud-program");
  assert.equal(result.progress, null);
  assert.equal(mock.calls.some((call) => call[0] === "daily_ritual_entries"), false);
  assert.equal(mock.writes, 0);
});

test("cloud table failure returns a safe load error without database details", async () => {
  const mock = mockSupabase({ failureTable: "weekly_reflections" });
  const result = await loadAccountProgress({
    getSession: async () => signedInSession(),
    repository: createCloudRepository({ client: mock.client }),
  });
  assert.equal(result.status, "cloud-load-error");
  assert.equal(result.error.code, "CLOUD_LOAD_FAILED");
  assert.doesNotMatch(result.error.message, /sensitive database response/);
});

test("network and expired-session failures receive safe application-level classifications", async () => {
  const networkClient = {
    auth: { async getUser() { return { data: { user: { id: USER_ID } }, error: null }; } },
    from(table) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order() { return builder; },
        then(resolve, reject) {
          const response = table === "arc_programs"
            ? { data: [PROGRAM], error: null }
            : { data: null, error: new TypeError("Failed to fetch") };
          return Promise.resolve(response).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const network = await createCloudRepository({ client: networkClient }).readDailyEntries();
  assert.equal(network.error.code, "CLOUD_NETWORK_ERROR");
  assert.doesNotMatch(network.error.message, /fetch/i);

  const expiredClient = {
    auth: { async getUser() {
      return { data: { user: null }, error: { status: 401, code: "AuthSessionMissingError", message: "session missing" } };
    } },
    from() { throw new Error("expired session must not query tables"); },
  };
  const expired = await createCloudRepository({ client: expiredClient }).loadProgress();
  assert.equal(expired.error.code, "AUTHENTICATION_REQUIRED");
  assert.doesNotMatch(expired.error.message, /session missing/i);
});

test("malformed or incomplete cloud rows fail safely instead of fabricating progress", async () => {
  const malformed = records();
  malformed.daily_ritual_entries[0].completed = "yes";
  const mock = mockSupabase({ tableRows: malformed });
  const result = await loadAccountProgress({
    getSession: async () => signedInSession(),
    repository: createCloudRepository({ client: mock.client }),
  });
  assert.equal(result.status, "cloud-load-error");
  assert.equal(result.error.code, "CLOUD_DATA_INVALID");
  assert.equal(result.progress, null);
});

test("a custom habit with no cloud definition is reported as incomplete", async () => {
  const incomplete = records();
  incomplete.custom_habit_definitions = [];
  const mock = mockSupabase({ tableRows: incomplete });
  const result = await loadAccountProgress({
    getSession: async () => signedInSession(),
    repository: createCloudRepository({ client: mock.client }),
  });
  assert.equal(result.status, "cloud-load-error");
  assert.equal(result.error.code, "CLOUD_DATA_INVALID");
});

test("an invalid completed Sleep Tracker row is rejected rather than silently changed", async () => {
  const malformed = records();
  malformed.daily_ritual_entries[2].completed = true;
  const mock = mockSupabase({ tableRows: malformed });
  const result = await loadAccountProgress({
    getSession: async () => signedInSession(),
    repository: createCloudRepository({ client: mock.client }),
  });
  assert.equal(result.status, "cloud-load-error");
  assert.equal(result.error.code, "CLOUD_DATA_INVALID");
});
