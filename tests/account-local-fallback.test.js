import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getProgressStorageKeyForAccount,
  loadProgress,
  PROGRESS_STORAGE_KEY,
  saveProgress,
  setProgressAccountScope,
} from "../src/data/storage.js";
import { getAccountDataMode } from "../src/data/accountDataMode.js";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

function withLocalStorage(callback) {
  const previousStorage = globalThis.localStorage;
  const previousWindow = globalThis.window;
  globalThis.localStorage = new MemoryStorage();
  globalThis.window = { dispatchEvent() {} };
  setProgressAccountScope(null);
  try {
    return callback(globalThis.localStorage);
  } finally {
    setProgressAccountScope(null);
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

test("ambiguous legacy browser data is never adopted by a signed-in account fallback", () => {
  withLocalStorage((storage) => {
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify({ startDate: "2025-01-01", entries: { "2025-01-01": { wake: { completed: true } } } }));
    setProgressAccountScope("user-a");
    assert.deepEqual(loadProgress().entries, {});
    assert.notEqual(getProgressStorageKeyForAccount(), PROGRESS_STORAGE_KEY);
    assert.ok(storage.getItem(PROGRESS_STORAGE_KEY), "legacy data remains available for explicit migration");
  });
});

test("User A and User B local fallback records stay isolated through account switching and logout", () => {
  withLocalStorage(() => {
    setProgressAccountScope("user-a");
    saveProgress({ startDate: "2026-01-01", entries: { "2026-01-01": { wake: { completed: true } } } });
    setProgressAccountScope("user-b");
    assert.deepEqual(loadProgress().entries, {});
    saveProgress({ startDate: "2026-02-01", entries: { "2026-02-01": { water: { value: 3 } } } });
    setProgressAccountScope(null);
    assert.deepEqual(loadProgress().entries, {});
    setProgressAccountScope("user-a");
    assert.equal(loadProgress().entries["2026-01-01"].wake.completed, true);
    setProgressAccountScope("user-b");
    assert.equal(loadProgress().entries["2026-02-01"].water.value, 3);
  });
});

test("cloud account mode stays authoritative when cloud data is available", () => {
  assert.equal(getAccountDataMode("loaded"), "cloud-read-only");
  assert.equal(getAccountDataMode("no-cloud-program"), "local-no-cloud-program");
  assert.equal(getAccountDataMode("cloud-load-error"), "local-cloud-error");
});

test("auth identity is set before app state exposes an authenticated account", () => {
  const source = readFileSync(new URL("../src/auth/AuthProvider.jsx", import.meta.url), "utf8");
  assert.match(source, /if \(active\)\s*\{\s*setProgressAccountScope\(nextUserId\);\s*setAuthState/);
  assert.match(source, /setProgressAccountScope\(error \? null : data\.user\?\.id \|\| null\);\s+setAuthState/);
  assert.match(source, /setProgressAccountScope\(null\);\s+\};/);
});
