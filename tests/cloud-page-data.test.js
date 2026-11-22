import assert from "node:assert/strict";
import test from "node:test";
import { getDailyAnalysisFromProgress } from "../src/data/dailyAnalysis.js";
import {
  getDaySnapshotFromProgress,
  getHistoryOverviewFromProgress,
  getRecordedDatesFromProgress,
  getWeeklyReflectionFromProgress,
  getMonthlyIntentionFromProgress,
} from "../src/data/storage.js";
import { getWeeklyCheckinFromProgress } from "../src/data/weeklyAnalysis.js";
import { getMonthlyAnalysisFromProgress } from "../src/data/monthlyAnalysis.js";
import { getAccountDataMode } from "../src/data/accountDataMode.js";
import { saveReflectionForMode } from "../src/data/reflectionWriteGuard.js";

const PROGRESS = {
  version: 1,
  startDate: "2026-01-01",
  entries: {
    "2026-01-01": {
      wake: { completed: true, value: null, completedAt: "2026-01-01T05:00:00Z", applicationTimes: [] },
      sunscreen: { completed: true, value: null, completedAt: "2026-01-01T08:00:00Z", applicationTimes: ["2026-01-01T08:00:00Z", "2026-01-01T12:00:00Z"] },
      "sleep-tracker": { completed: false, value: 6.5, completedAt: null, applicationTimes: [] },
      "custom-reading": { completed: true, value: 25, completedAt: "2026-01-01T19:00:00Z", applicationTimes: [] },
    },
    "2026-01-02": {
      steps: { completed: true, value: 10000, completedAt: "2026-01-02T18:00:00Z", applicationTimes: [] },
      "sleep-tracker": { completed: false, value: 7.5, completedAt: null, applicationTimes: [] },
    },
  },
  customHabits: [{ id: "custom-reading", title: "Read a chapter", type: "measurable", unit: "pages", goal: 20, archived: false, order: 0 }],
  ritualSnapshots: {
    "2026-01-01": [
      { id: "wake", title: "Wake Up Early", type: "boolean" },
      { id: "sunscreen", title: "Apply Sunscreen", type: "boolean" },
      { id: "sleep-tracker", title: "Sleep Tracker", goalMin: 7, goalMax: 9, unit: "hours" },
      { id: "custom-reading", title: "Read a chapter", type: "measurable", source: "custom", goal: 20, unit: "pages" },
    ],
    "2026-01-02": [
      { id: "steps", title: "10,000 Steps", type: "measurable", goal: 10000, unit: "steps" },
      { id: "sleep-tracker", title: "Sleep Tracker", goalMin: 7, goalMax: 9, unit: "hours" },
    ],
  },
  weeklyReflections: { "2026-01-01": { wins: "Kept showing up", challenges: "Short sleep", focus: "Keep walking" } },
  monthlyReflections: { "2026-01": { intention: "Move with care" } },
};

test("cloud history uses each date's saved ritual snapshot and keeps custom/sunscreen/sleep data", () => {
  assert.deepEqual(getRecordedDatesFromProgress(PROGRESS), ["2026-01-02", "2026-01-01"]);
  const first = getDaySnapshotFromProgress(PROGRESS, "2026-01-01");
  const second = getDaySnapshotFromProgress(PROGRESS, "2026-01-02");
  assert.deepEqual(first.rows.map(({ ritual }) => ritual.id), ["wake", "sunscreen", "sleep-tracker", "custom-reading"]);
  assert.deepEqual(second.rows.map(({ ritual }) => ritual.id), ["steps", "sleep-tracker"]);
  assert.deepEqual(first.rows.find(({ ritual }) => ritual.id === "sunscreen").entry.applicationTimes, [
    "2026-01-01T08:00:00Z", "2026-01-01T12:00:00Z",
  ]);
  assert.equal(first.rows.find(({ ritual }) => ritual.id === "sleep-tracker").status.completed, false);
  assert.equal(first.rows.find(({ ritual }) => ritual.id === "custom-reading").status.value, 25);
  assert.deepEqual(getHistoryOverviewFromProgress(PROGRESS, new Date(2026, 0, 2)), {
    currentDay: 2, recordedDays: 2, daysWithCompletion: 2,
  });
});

test("cloud daily, weekly, and monthly analysis consume progress without local storage", () => {
  const previous = globalThis.localStorage;
  const storageCalls = [];
  globalThis.localStorage = {
    getItem(...args) { storageCalls.push(["get", ...args]); throw new Error("local storage must not be touched"); },
    setItem(...args) { storageCalls.push(["set", ...args]); throw new Error("local storage must not be touched"); },
  };
  try {
    const daily = getDailyAnalysisFromProgress(PROGRESS, "2026-01-01");
    assert.equal(daily.recorded, true);
    assert.equal(daily.snapshot.rows.find(({ ritual }) => ritual.id === "sunscreen").entry.applicationTimes.length, 2);
    assert.equal(daily.snapshot.rows.find(({ ritual }) => ritual.id === "sleep-tracker").status.completed, false);

    const weekly = getWeeklyCheckinFromProgress(PROGRESS, "2026-01-01", "2026-01-02");
    assert.equal(weekly.recordedDays, 2);
    assert.ok(weekly.patterns.some(({ ritual }) => ritual.id === "custom-reading"));
    assert.equal(weekly.sleep.recorded, 2);
    assert.deepEqual(getWeeklyReflectionFromProgress(PROGRESS, "2026-01-01"), PROGRESS.weeklyReflections["2026-01-01"]);

    const monthly = getMonthlyAnalysisFromProgress(PROGRESS, "2026-01", "2026-01-02");
    assert.equal(monthly.recordedDays, 2);
    assert.ok(monthly.habits.some(({ ritual }) => ritual.id === "custom-reading"));
    assert.equal(monthly.sleep.recorded, 2);
    assert.equal(getMonthlyIntentionFromProgress(PROGRESS, "2026-01"), "Move with care");
    assert.deepEqual(storageCalls, []);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("empty cloud periods retain empty analysis behavior and account modes use local fallback safely", () => {
  const empty = { ...PROGRESS, entries: {}, ritualSnapshots: {}, customHabits: [] };
  const daily = getDailyAnalysisFromProgress(empty, "2026-01-04");
  assert.equal(daily.recorded, false);
  const month = getMonthlyAnalysisFromProgress(empty, "2026-01", "2026-01-04");
  assert.equal(month.hasRecordedData, false);
  assert.equal(month.recordedDays, 0);
  assert.equal(getAccountDataMode("unauthenticated"), "local");
  assert.equal(getAccountDataMode("no-cloud-program"), "local-no-cloud-program");
  assert.equal(getAccountDataMode("cloud-load-error"), "local-cloud-error");
});

test("weekly and monthly reflection persistence is blocked in cloud read-only mode", () => {
  const writes = [];
  const weeklyWriter = (...args) => writes.push(["weekly", ...args]);
  const monthlyWriter = (...args) => writes.push(["monthly", ...args]);
  assert.equal(saveReflectionForMode("cloud-read-only", weeklyWriter, "2026-01-01", { wins: "changed" }), false);
  assert.equal(saveReflectionForMode("cloud-read-only", monthlyWriter, "2026-01", "changed"), false);
  assert.deepEqual(writes, []);
  assert.equal(saveReflectionForMode("local", weeklyWriter, "2026-01-01", { wins: "saved locally" }), true);
  assert.equal(writes.length, 1);
});
