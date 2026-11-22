import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getWeeklyCheckinFromProgress } from "../src/data/weeklyAnalysis.js";
import { getMonthlyAnalysisFromProgress } from "../src/data/monthlyAnalysis.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Journey exposes one-at-a-time accessible week and month accordions", async () => {
  const source = await read("../src/components/JourneyPage.jsx");
  const styles = await read("../src/components/JourneyPage.css");

  assert.match(source, /const \[openSection, setOpenSection\] = useState\(null\)/);
  assert.match(source, /aria-expanded=\{openSection === "week"\}/);
  assert.match(source, /aria-expanded=\{openSection === "month"\}/);
  assert.match(source, /aria-controls="journey-week-details"/);
  assert.match(source, /aria-controls="journey-month-details"/);
  assert.match(source, /setOpenSection\(\(current\) => current === "week" \? null : "week"\)/);
  assert.match(source, /setOpenSection\(\(current\) => current === "month" \? null : "month"\)/);
  assert.match(source, /hidden=\{openSection !== "week"\}/);
  assert.match(source, /hidden=\{openSection !== "month"\}/);
  assert.match(source, /Week \{week\.weekNumber\}/);
  assert.match(source, /formatPeriodRange\(week\.weekStartIso, week\.weekEndIso\)/);
  assert.match(source, /\{month\.monthLabel\}/);
  assert.match(source, /formatPeriodRange\(month\.startDate, month\.endDate\)/);
  assert.match(styles, /\.journey-accordion-trigger:focus-visible/);
  assert.match(styles, /\.journey-accordion-panel\[hidden\]/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /min-height: 72px/);
});

test("weekly and monthly accordion bodies retain their analysis and reflection controls", async () => {
  const source = await read("../src/components/JourneyPage.jsx");

  assert.match(source, /<section className="analysis-card week-card">/);
  assert.match(source, /<section className="analysis-card monthly-card">/);
  assert.equal((source.match(/className="reflection-save-button"/g) || []).length, 2);
  assert.match(source, /className="journey-accordion-panel" hidden=\{openSection !== "week"\}>\s*<section className="analysis-card week-card">/);
  assert.match(source, /className="journey-accordion-panel" hidden=\{openSection !== "month"\}>\s*<section className="analysis-card monthly-card">/);
  assert.match(source, /getDailyAnalysisFromProgress\(currentProgress, iso\)/);
});

test("accordion period labels can use Arc-aligned and current-date-clipped analysis ranges", () => {
  const progress = { version: 1, startDate: "2026-10-01", entries: {}, customHabits: [], ritualSnapshots: {} };
  const week = getWeeklyCheckinFromProgress(progress, "2026-10-08", "2026-10-10");
  const month = getMonthlyAnalysisFromProgress(progress, "2026-10", "2026-10-10");

  assert.equal(week.weekNumber, 2);
  assert.equal(week.weekStartIso, "2026-10-08");
  assert.equal(week.weekEndIso, "2026-10-14");
  assert.equal(month.monthLabel, "October 2026");
  assert.equal(month.startDate, "2026-10-01");
  assert.equal(month.endDate, "2026-10-10");
  assert.equal(month.hasRecordedData, false);
});
