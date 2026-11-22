import assert from "node:assert/strict";
import test from "node:test";
import { createAccountDataController } from "../src/data/accountDataController.js";
import { getAccountDataMode } from "../src/data/accountDataMode.js";

const USER_A = "user-a";
const USER_B = "user-b";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("unauthenticated accounts select the existing local Today mode", async () => {
  const controller = createAccountDataController({
    loadProgress: async () => { throw new Error("must not load cloud progress"); },
  });
  await controller.setAccount({ userId: null, loading: false });
  assert.equal(controller.getState().status, "unauthenticated");
  assert.equal(getAccountDataMode(controller.getState().status), "local");
});

test("authenticated cloud data switches Today to a read-only cloud model", async () => {
  const progress = { startDate: "2026-01-01", entries: {}, customHabits: [] };
  const controller = createAccountDataController({
    loadProgress: async ({ expectedUserId }) => ({
      status: "loaded", progress: { ...progress, account: expectedUserId }, error: null,
    }),
  });
  await controller.setAccount({ userId: USER_A });
  assert.equal(controller.getState().status, "loaded");
  assert.equal(controller.getState().progress.account, USER_A);
  assert.equal(getAccountDataMode(controller.getState().status), "cloud-read-only");
});

test("no-program and cloud-error states safely select local fallback modes", async () => {
  const responses = [
    { status: "no-cloud-program", progress: null, error: null },
    { status: "cloud-load-error", progress: null, error: { code: "CLOUD_LOAD_FAILED", message: "Try again." } },
  ];
  const controller = createAccountDataController({ loadProgress: async () => responses.shift() });
  await controller.setAccount({ userId: USER_A });
  assert.equal(getAccountDataMode(controller.getState().status), "local-no-cloud-program");
  await controller.setAccount({ userId: USER_B });
  assert.equal(getAccountDataMode(controller.getState().status), "local-cloud-error");
  assert.equal(controller.getState().error.message, "Try again.");
});

test("loading clears previous account progress before the next load resolves", async () => {
  const pending = deferred();
  const controller = createAccountDataController({ loadProgress: () => pending.promise });
  const request = controller.setAccount({ userId: USER_A });
  assert.equal(controller.getState().status, "loading");
  assert.equal(controller.getState().progress, null);
  assert.equal(getAccountDataMode(controller.getState().status), "loading");
  pending.resolve({ status: "loaded", progress: { account: USER_A }, error: null });
  await request;
});

test("a stale User A response cannot replace User B cloud state", async () => {
  const pendingA = deferred();
  const pendingB = deferred();
  const controller = createAccountDataController({
    loadProgress: ({ expectedUserId }) => expectedUserId === USER_A ? pendingA.promise : pendingB.promise,
  });
  const requestA = controller.setAccount({ userId: USER_A });
  const requestB = controller.setAccount({ userId: USER_B });
  assert.equal(controller.getState().userId, USER_B);
  assert.equal(controller.getState().progress, null);

  pendingA.resolve({ status: "loaded", progress: { account: USER_A }, error: null });
  await requestA;
  assert.equal(controller.getState().status, "loading");
  assert.equal(controller.getState().progress, null);

  pendingB.resolve({ status: "loaded", progress: { account: USER_B }, error: null });
  await requestB;
  assert.equal(controller.getState().status, "loaded");
  assert.equal(controller.getState().progress.account, USER_B);
});

test("sign-out clears a previously loaded account snapshot immediately", async () => {
  const controller = createAccountDataController({
    loadProgress: async () => ({ status: "loaded", progress: { secret: "account data" }, error: null }),
  });
  await controller.setAccount({ userId: USER_A });
  await controller.setAccount({ userId: null });
  assert.equal(controller.getState().status, "unauthenticated");
  assert.equal(controller.getState().progress, null);
});

test("a rejected cloud load enters local fallback without retaining partial account data", async () => {
  const controller = createAccountDataController({
    loadProgress: async () => { throw new TypeError("Failed to fetch"); },
  });
  await controller.setAccount({ userId: USER_A });
  const state = controller.getState();
  assert.equal(state.status, "cloud-load-error");
  assert.equal(state.progress, null);
  assert.equal(getAccountDataMode(state.status), "local-cloud-error");
  assert.equal(state.error.code, "CLOUD_LOAD_FAILED");
});

test("retry replaces local fallback with cloud data only after a complete successful load", async () => {
  const responses = [
    { status: "cloud-load-error", progress: null, error: { code: "CLOUD_NETWORK_ERROR", message: "Offline" } },
    { status: "loaded", progress: { source: "cloud", entries: {} }, programId: "program-a", error: null },
  ];
  const controller = createAccountDataController({ loadProgress: async () => responses.shift() });
  await controller.setAccount({ userId: USER_A });
  assert.equal(getAccountDataMode(controller.getState().status), "local-cloud-error");
  assert.equal(controller.getState().progress, null);

  await controller.retry();
  assert.equal(controller.getState().status, "loaded");
  assert.equal(controller.getState().progress.source, "cloud");
  assert.equal(getAccountDataMode(controller.getState().status), "cloud-read-only");
});

test("failed retry remains in fallback and a session-expiration sign-out clears cloud state", async () => {
  const controller = createAccountDataController({
    loadProgress: async () => ({
      status: "cloud-load-error", progress: null,
      error: { code: "CLOUD_LOAD_FAILED", message: "Unavailable" },
    }),
  });
  await controller.setAccount({ userId: USER_A });
  await controller.retry();
  assert.equal(getAccountDataMode(controller.getState().status), "local-cloud-error");
  await controller.setAccount({ userId: null });
  assert.equal(controller.getState().status, "unauthenticated");
  assert.equal(controller.getState().progress, null);
  assert.equal(getAccountDataMode(controller.getState().status), "local");
});

test("refresh starts from loading and reloads only the authenticated cloud account", async () => {
  const progress = { source: "cloud", entries: {}, customHabits: [] };
  const controller = createAccountDataController({
    loadProgress: async ({ expectedUserId }) => ({
      status: "loaded", userId: expectedUserId, programId: "program-a", progress, error: null,
    }),
  });
  const pending = controller.setAccount({ userId: USER_A });
  assert.equal(controller.getState().status, "loading");
  assert.equal(controller.getState().progress, null);
  await pending;
  assert.equal(controller.getState().progress.source, "cloud");
  assert.equal(controller.getState().userId, USER_A);
});

test("daily update requires the current program and leaves historical snapshots untouched", async () => {
  const snapshots = { "2026-01-01": [{ id: "wake", title: "Wake Up Early" }] };
  const controller = createAccountDataController({
    loadProgress: async () => ({
      status: "loaded", programId: "program-a",
      progress: { entries: {}, ritualSnapshots: snapshots }, error: null,
    }),
  });
  await controller.setAccount({ userId: USER_A });
  assert.equal(controller.applyDailyEntry({
    userId: USER_A, programId: "another-program", dateISO: "2026-01-02", ritualId: "wake", entry: { completed: true },
  }), false);
  assert.equal(controller.applyDailyEntry({
    userId: USER_A, programId: "program-a", dateISO: "2026-01-02", ritualId: "wake", entry: { completed: true },
  }), true);
  assert.equal(controller.getState().progress.ritualSnapshots, snapshots);
});

test("an expired session can leave cloud mode without exposing its old account snapshot", async () => {
  let loadCount = 0;
  const controller = createAccountDataController({
    loadProgress: async () => {
      loadCount += 1;
      return loadCount === 1
        ? { status: "loaded", progress: { account: USER_A }, programId: "program-a", error: null }
        : { status: "unauthenticated", progress: null, error: null };
    },
  });
  await controller.setAccount({ userId: USER_A });
  assert.equal(getAccountDataMode(controller.getState().status), "cloud-read-only");
  await controller.retry(USER_A);
  assert.equal(controller.getState().status, "unauthenticated");
  assert.equal(controller.getState().progress, null);
  assert.equal(getAccountDataMode(controller.getState().status), "local");
});

test("an old account cannot request a retry that reloads the newly selected user's data", async () => {
  let loads = 0;
  const controller = createAccountDataController({
    loadProgress: async ({ expectedUserId }) => {
      loads += 1;
      return { status: "loaded", progress: { account: expectedUserId }, programId: `program-${expectedUserId}`, error: null };
    },
  });
  await controller.setAccount({ userId: USER_A });
  await controller.setAccount({ userId: USER_B });
  const loadCountBeforeStaleRetry = loads;
  await controller.retry(USER_A);
  assert.equal(loads, loadCountBeforeStaleRetry);
  assert.equal(controller.getState().progress.account, USER_B);
});
