import assert from "node:assert/strict";
import test from "node:test";
import { getRitualStatus } from "../src/data/ritualStatus.js";
import { createTodayCloudModel } from "../src/data/todayCloudModel.js";

test("Today derives cloud entries, custom habits, and the existing progress semantics", () => {
  const date = new Date(2026, 0, 2, 12);
  const progress = {
    version: 1,
    startDate: "2026-01-01",
    entries: {
      "2026-01-02": {
        wake: { completed: true, value: null, completedAt: "2026-01-02T05:00:00Z" },
        water: { completed: false, value: 4, completedAt: null },
        sunscreen: {
          completed: true,
          value: null,
          completedAt: "2026-01-02T08:00:00Z",
          applicationTimes: ["2026-01-02T08:00:00Z", "2026-01-02T12:00:00Z"],
        },
        "sleep-tracker": { completed: false, value: 7.5, completedAt: null },
        "custom-reading": { completed: true, value: null, completedAt: "2026-01-02T17:00:00Z" },
      },
    },
    customHabits: [
      { id: "custom-reading", title: "Read a chapter", type: "boolean", archived: false, order: 0 },
      { id: "old-habit", title: "Archived habit", type: "boolean", archived: true, order: 1 },
    ],
  };

  const model = createTodayCloudModel(progress, date);
  assert.equal(model.dayNumber, 2);
  assert.equal(model.entries.wake.completed, true);
  assert.equal(model.entries.sunscreen.applicationTimes.length, 2);
  assert.equal(model.entries["sleep-tracker"].completed, false);
  assert.equal(model.rituals.some((ritual) => ritual.id === "custom-reading"), true);
  assert.equal(model.rituals.some((ritual) => ritual.id === "old-habit"), false);

  const water = model.rituals.find((ritual) => ritual.id === "water");
  assert.equal(getRitualStatus(water, model.entries.water).inProgress, true);
  const sleepTracker = model.rituals.find((ritual) => ritual.id === "sleep-tracker");
  assert.equal(getRitualStatus(sleepTracker, model.entries["sleep-tracker"]).completed, false);
});

test("cloud Today model creation does not read or mutate browser localStorage", () => {
  const previous = globalThis.localStorage;
  const calls = [];
  globalThis.localStorage = {
    getItem(...args) { calls.push(["get", ...args]); return "sentinel"; },
    setItem(...args) { calls.push(["set", ...args]); },
  };
  try {
    createTodayCloudModel({ startDate: "2026-10-01", entries: {}, customHabits: [] }, new Date(2026, 9, 2));
    assert.deepEqual(calls, []);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
