import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RITUALS } from "../src/data/rituals.js";
import {
  ARC_DURATION_DAYS,
  clampDateToArc,
  getArcEndDate,
  getDayNumberFromProgress,
  getDaySnapshotFromProgress,
  getRecordedDatesFromProgress,
  isDateWithinArc,
  mergeRitualEntry,
} from "../src/data/storage.js";
import {
  canCompleteSkincareAt,
  canCompleteSleepOnTimeAt,
  getHealthyMealsCount,
  getRitualStatus,
  getSunscreenApplicationCount,
} from "../src/data/ritualStatus.js";
import { createTodayCloudModel } from "../src/data/todayCloudModel.js";
import { getWeeklyCheckinFromProgress, getWeekStartIsoFromProgress } from "../src/data/weeklyAnalysis.js";
import { getMonthlyAnalysisFromProgress } from "../src/data/monthlyAnalysis.js";
import { reconstructCloudProgress } from "../src/data/cloud/reconstructCloudProgress.js";
import { getNextSunscreenApplicationTime } from "../src/data/sunscreenGuidance.js";
import { formatArcDateRange, getLandingArcState } from "../src/data/landingExperience.js";

const ritual = (id) => RITUALS.find((item) => item.id === id);

test("Winter Arc duration is 92 inclusive calendar days and ends writing after day 92", () => {
  const progress = { startDate: "2026-01-01", entries: { "2026-04-02": { wake: { completed: true } }, "2026-04-03": { wake: { completed: true } } } };
  assert.equal(ARC_DURATION_DAYS, 92);
  assert.equal(getDayNumberFromProgress(progress, new Date(2026, 0, 1)), 1);
  assert.equal(getArcEndDate(progress.startDate), "2026-04-02");
  assert.equal(isDateWithinArc(progress, "2026-04-02"), true);
  assert.equal(isDateWithinArc(progress, "2026-04-03"), false);
  assert.equal(getDayNumberFromProgress(progress, new Date(2026, 3, 1)), 91);
  assert.equal(getDayNumberFromProgress(progress, new Date(2026, 3, 2)), 92);
  assert.equal(getDayNumberFromProgress(progress, new Date(2026, 3, 3)), 92);
  assert.equal(getDayNumberFromProgress(progress, new Date(2026, 3, 2)) / ARC_DURATION_DAYS * 100, 100);
  assert.equal(clampDateToArc(progress, "2026-04-03"), "2026-04-02");
  assert.deepEqual(getDaySnapshotFromProgress(progress, "2026-04-03").rows, []);
  assert.deepEqual(getRecordedDatesFromProgress(progress), ["2026-04-02"]);
  assert.ok(Object.hasOwn(progress.entries, "2026-04-02"));
  assert.ok(Object.hasOwn(progress.entries, "2026-04-03"));
  const beyondArcToday = createTodayCloudModel(progress, new Date(2026, 3, 3, 12));
  assert.equal(beyondArcToday.arcActive, false);
  assert.equal(beyondArcToday.dayNumber, 92);
});

test("October 1 Arc displays October 4 as day 4 of 92 and ends December 31", () => {
  const progress = { startDate: "2026-10-01", entries: { "2026-10-01": { wake: { completed: true } } } };
  const arc = getLandingArcState(progress, new Date(2026, 9, 4));
  assert.equal(arc.dayNumber, 4);
  assert.equal(arc.endDate, "2026-12-31");
  assert.equal(formatArcDateRange(arc.startDate, arc.endDate), "OCT 1 — DEC 31");
});

test("Read / Learn remains a 20-minute target and Sleep On Time closes at 11 PM local time", () => {
  assert.equal(ritual("learn").goal, 20);
  assert.equal(canCompleteSleepOnTimeAt(new Date(2026, 0, 1, 22, 59)), true);
  assert.equal(canCompleteSleepOnTimeAt(new Date(2026, 0, 1, 23, 0)), false);
  assert.equal(canCompleteSleepOnTimeAt(new Date(Number.NaN)), false);
});

test("Sleep On Time cannot be newly completed after the local 11 PM cutoff", () => {
  const source = readFileSync(new URL("../src/components/RitualPage.jsx", import.meta.url), "utf8");
  assert.match(source, /if \(!arcActive \|\| skincareLocked \|\| sleepCompletionLocked\) return;/);
  assert.match(source, /disabled=\{saving \|\| !arcActive \|\| skincareLocked \|\| sleepCompletionLocked\}/);
});

test("Sunscreen completion requires two valid application timestamps and keeps the times", () => {
  const sunscreen = ritual("sunscreen");
  const one = { completed: false, applicationTimes: ["2026-01-01T08:00:00Z"] };
  const two = { completed: false, applicationTimes: ["2026-01-01T08:00:00Z", "2026-01-01T11:00:00Z"] };
  assert.equal(getSunscreenApplicationCount({ applicationTimes: [...two.applicationTimes, "invalid"] }), 2);
  assert.equal(getRitualStatus(sunscreen, one).completed, false);
  assert.equal(getRitualStatus(sunscreen, one).inProgress, true);
  assert.equal(getRitualStatus(sunscreen, two).completed, true);
  assert.equal(getRitualStatus(sunscreen, { completed: false, applicationTimes: [] }).completed, false);
  assert.equal(getRitualStatus(sunscreen, { completed: false, applicationTimes: [...two.applicationTimes, "2026-01-01T14:00:00Z"] }).completed, true);
  assert.equal(getRitualStatus(sunscreen, { completed: true, applicationTimes: [] }).completed, false);
  const merged = mergeRitualEntry(sunscreen, one, { applicationTimes: two.applicationTimes });
  assert.equal(merged.completed, true);
  assert.deepEqual(merged.applicationTimes, two.applicationTimes);

  const progress = { startDate: "2026-01-01", entries: { "2026-01-01": { sunscreen: two } }, ritualSnapshots: {}, customHabits: [] };
  const snapshot = getDaySnapshotFromProgress(progress, "2026-01-01");
  assert.equal(snapshot.rows.filter(({ ritual: item }) => item.id === "sunscreen").length, 1);
  assert.equal(snapshot.completedCount, 1);
});

test("Sunscreen guidance never presents a next application at or after 7 PM local time", () => {
  const applicationAtFour = new Date(2026, 0, 1, 16, 0, 0);
  const applicationAtThreeFiftyNine = new Date(2026, 0, 1, 15, 59, 0);
  const beforeCutoff = new Date(2026, 0, 1, 18, 59, 59);
  const atCutoff = new Date(2026, 0, 1, 19, 0, 0);

  assert.equal(getNextSunscreenApplicationTime(applicationAtFour.toISOString(), beforeCutoff), null);
  assert.equal(getNextSunscreenApplicationTime(applicationAtThreeFiftyNine.toISOString(), beforeCutoff), new Date(2026, 0, 1, 18, 59, 0).toISOString());
  assert.equal(getNextSunscreenApplicationTime(applicationAtThreeFiftyNine.toISOString(), atCutoff), null);
  assert.equal(getNextSunscreenApplicationTime("not-a-timestamp", beforeCutoff), null);
});

test("Healthy Meals stores three independent meal selections and completes at two", () => {
  const food = ritual("food");
  assert.deepEqual([0, 1, 3, 7].map((value) => getHealthyMealsCount({ value })), [0, 1, 2, 3]);
  assert.equal(getRitualStatus(food, { value: 1, completed: false }).inProgress, true);
  assert.equal(getRitualStatus(food, { value: 3, completed: true }).completed, true);
  assert.equal(getRitualStatus(food, { value: 1, completed: true }).completed, false);
  assert.equal(getRitualStatus(food, { value: null, completed: true }).legacy, true);

  const reconstructed = reconstructCloudProgress({
    program: { id: "program", user_id: "user", start_date: "2026-01-01" },
    dailyEntries: [{
      program_id: "program", user_id: "user", entry_date: "2026-01-01", ritual_id: "food",
      record_kind: "boolean", completed: true, value: null, completed_at: "2026-01-01T12:00:00Z",
      application_times: [], revision: 1,
    }],
  });
  assert.equal(reconstructed.error, null);
  assert.equal(getRitualStatus(food, reconstructed.data.entries["2026-01-01"].food).legacy, true);
});

test("skincare unlocks at 8 PM local time and appears before Sleep Tracker", () => {
  assert.equal(canCompleteSkincareAt(new Date(2026, 0, 1, 19, 59)), false);
  assert.equal(canCompleteSkincareAt(new Date(2026, 0, 1, 20, 0)), true);
  assert.equal(getRitualStatus(ritual("skincare"), { completed: true }).completed, true);
  assert.ok(RITUALS.findIndex(({ id }) => id === "skincare") < RITUALS.findIndex(({ id }) => id === "sleep-tracker"));
});

test("Today places Sleep Tracker after custom habits and hides post-Arc entries", () => {
  const progress = {
    startDate: "2026-01-01",
    entries: { "2026-04-02": { wake: { completed: true } }, "2026-04-03": { wake: { completed: true } } },
    customHabits: [{ id: "custom-test", title: "Custom", type: "boolean", archived: false, order: 0 }],
  };
  const finalArcDay = createTodayCloudModel(progress, new Date(2026, 3, 2, 12));
  assert.equal(finalArcDay.arcActive, true);
  assert.ok(finalArcDay.rituals.findIndex(({ id }) => id === "custom-test") < finalArcDay.rituals.findIndex(({ id }) => id === "sleep-tracker"));
  const afterArc = createTodayCloudModel(progress, new Date(2026, 3, 3, 12));
  assert.equal(afterArc.arcActive, false);
  assert.deepEqual(afterArc.entries, {});
  assert.deepEqual(getRecordedDatesFromProgress(progress), ["2026-04-02"]);

  const snapshot = getDaySnapshotFromProgress({
    startDate: "2026-10-01",
    entries: { "2026-10-03": { "custom-test": { completed: true }, "sleep-tracker": { completed: false, value: 8 } } },
    customHabits: [{ id: "custom-test", title: "Custom", type: "boolean", archived: false, order: 0 }],
    ritualSnapshots: {},
  }, "2026-10-03");
  assert.ok(snapshot.rows.findIndex(({ ritual: item }) => item.id === "custom-test") < snapshot.rows.findIndex(({ ritual: item }) => item.id === "sleep-tracker"));
  assert.equal(snapshot.rows.find(({ ritual: item }) => item.id === "sleep-tracker").status.completed, false);
  assert.equal(snapshot.total, snapshot.rows.length - 1);
});

test("weekly and monthly analysis stop at the 92-day Arc end", () => {
  const progress = { startDate: "2026-01-01", entries: {}, ritualSnapshots: {}, customHabits: [] };
  const week = getWeeklyCheckinFromProgress(progress, "2026-04-02", "2026-04-02");
  assert.equal(getWeekStartIsoFromProgress(progress, "2026-02-20"), "2026-02-19");
  assert.equal(week.weekStartIso, "2026-04-02");
  assert.equal(week.weekEndIso, "2026-04-02");
  assert.equal(week.daysInWeek, 1);
  const finalArcMonth = getMonthlyAnalysisFromProgress(progress, "2026-03", "2026-04-01");
  assert.equal(finalArcMonth.eligibleDays, 31);
  assert.equal(finalArcMonth.startDate, "2026-03-01");
  assert.equal(finalArcMonth.endDate, "2026-03-31");
  const month = getMonthlyAnalysisFromProgress(progress, "2026-04", "2026-04-30");
  assert.equal(month.eligibleDays, 2);
  assert.equal(month.startDate, "2026-04-01");
  assert.equal(month.endDate, "2026-04-02");
});
