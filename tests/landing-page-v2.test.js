import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatArcDateRange,
  getLandingArcState,
  getLandingPromiseState,
  LANDING_CREATOR_STORY,
  loadLandingChallengeSummary,
} from "../src/data/landingExperience.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("landing Arc day and date range derive from the existing program start date", () => {
  const progress = { startDate: "2026-10-04", entries: {}, ritualSnapshots: {} };
  const active = getLandingArcState(progress, new Date(2026, 9, 5), true);
  assert.equal(active.status, "active");
  assert.equal(active.dayNumber, 2);
  assert.equal(formatArcDateRange(active.startDate, active.endDate), "OCT 4, 2026 — JAN 3, 2027");

  assert.equal(getLandingArcState(progress, new Date(2026, 9, 3), true).status, "upcoming");
  assert.equal(getLandingArcState(progress, new Date(2027, 0, 4), true).status, "complete");
  assert.equal(getLandingArcState({ startDate: "2026-10-04", entries: {}, ritualSnapshots: {} }, new Date(2026, 9, 4)).status, "not-started");
  assert.equal(getLandingArcState({ startDate: "2026-10-04", entries: { "2026-10-04": { wake: { completed: true } } } }, new Date(2026, 9, 4)).dayNumber, 1);
});

test("landing challenge summary exposes only the selected challenge and aggregate progress", async () => {
  const result = await loadLandingChallengeSummary({
    async list() {
      return { data: [{ id: "challenge-id", name: "Quiet Season", status: "active", member_count: 2, invite_code: "PRIVATE-CODE", owner_name: "Private Name" }] };
    },
    async read() {
      return { data: { members: [
        { display_name: "A Member", progress_percent: 40, email: "private@example.test" },
        { display_name: "Another Member", progress_percent: 60, user_id: "private-id" },
      ] } };
    },
  });
  assert.deepEqual(result, {
    status: "active",
    id: "challenge-id",
    name: "Quiet Season",
    memberCount: 2,
    aggregateProgress: 50,
  });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-CODE|Private Name|A Member|email|user_id|private-id/);
});

test("landing challenge handles no challenge and repository failure safely", async () => {
  assert.deepEqual(await loadLandingChallengeSummary({ async list() { return { data: [] }; } }), { status: "empty" });
  assert.deepEqual(await loadLandingChallengeSummary({ async list() { throw new Error("network"); } }), { status: "unavailable" });
});

test("promise confirmation is transient and reflects the actual Arc lifecycle", () => {
  assert.equal(getLandingPromiseState({ status: "not-started", hasStarted: false }), "unstarted");
  assert.equal(getLandingPromiseState({ status: "not-started", hasStarted: false }, true), "confirmed");
  assert.equal(getLandingPromiseState({ status: "active", hasStarted: true }), "started");
  assert.equal(getLandingPromiseState({ status: "complete", hasStarted: true }, true), "complete");
});

test("Landing preserves semantic composition, truthful state, existing routes, sleep summary, and transient promise confirmation", async () => {
  const landing = await read("../src/components/LandingPage.jsx");
  const today = await read("../src/components/TodayDashboard.jsx");
  const app = await read("../src/App.jsx");
  const css = await read("../src/App.css");
  assert.match(landing, /<main className="landing-main">/);
  assert.match(landing, /getLandingArcState\(progress, currentDate, accountMode === "cloud-read-only"\)/);
  assert.match(landing, /\$\{String\(arc\.dayNumber\)\.padStart\(2, "0"\)\} \/ \$\{ARC_DURATION_DAYS\}/);
  assert.match(landing, /displayName && isAuthenticated/);
  assert.match(landing, /getSleepSummaryFromProgress\(progress, dateISO\)/);
  assert.match(landing, /to=\{isAuthenticated \? "\/ritual\/sleep-tracker" : "\/login"\}/);
  assert.match(landing, /setPromiseConfirmationKey\(promiseKey\)/);
  assert.match(landing, /promiseConfirmationKey === promiseKey/);
  assert.match(landing, /getLandingPromiseState\(arc, promiseConfirmed\)/);
  assert.doesNotMatch(landing, /localStorage|saveProgress|signUp\(/);
  assert.doesNotMatch(today, /today-friends-challenge|<Link to="\/challenge">Friends Challenge/);
  assert.match(app, /<Route path="\/challenge"/);
  assert.match(landing, /Create Challenge/);
  assert.match(landing, /Join Challenge/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.landing-v2 \*, \.landing-v2 \*::before, \.landing-v2 \*::after/);
  assert.match(css, /\.moment-rise/);
  assert.match(css, /\.moment-build/);
  assert.match(css, /\.moment-learn/);
  assert.match(css, /\.moment-still/);
  assert.deepEqual(LANDING_CREATOR_STORY.story, [
    "I’ve always believed that becoming a better version of yourself shouldn’t mean being hard on yourself every single day.",
    "There are days when we feel motivated, and days when we don’t. Days when everything goes according to plan, and days when simply showing up is an achievement.",
    "Winter Arc was created from that idea — that small, consistent choices can slowly shape the life we want.",
    "I wanted to build a space that brings together discipline, self-care, reflection, learning, movement, rest, and faith — without making growth feel like punishment.",
    "A place to remind yourself that you don't have to become someone else.",
    "You just have to keep becoming.",
  ]);
  assert.equal(LANDING_CREATOR_STORY.signature, "— Manogna Ganji");
  assert.doesNotMatch(landing, /user\.email|user\.id\}\}/);
});

test("Landing keeps the restored section order and applies local-time themes to the Hero only", async () => {
  const landing = await read("../src/components/LandingPage.jsx");
  const css = await read("../src/App.css");
  const sectionOrder = [...landing.matchAll(/<section\b[^>]*className="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(sectionOrder, [
    "hero-scene",
    "connection-rest-section",
    "idea-section",
    "moments-section",
    "promise-section",
    "personal-ending-section",
  ]);
  assert.match(landing, /function getHeroTimeTheme\(date\)/);
  assert.match(landing, /hour >= 5 && hour < 12\) return "morning"/);
  assert.match(landing, /hour >= 12 && hour < 17\) return "afternoon"/);
  assert.match(landing, /hour >= 17 && hour < 22\) return "evening"/);
  assert.match(landing, /return "night"/);
  assert.match(landing, /data-time-theme=\{heroTimeTheme\}/);
  const laterSections = landing.slice(landing.indexOf('<main className="landing-main">'));
  assert.doesNotMatch(laterSections, /data-time-theme/);
  const heroThemeSelectors = [...css.matchAll(/([^{}]*\[data-time-theme="(?:morning|afternoon|evening|night)"\][^{}]*)\{/g)]
    .map((match) => match[1].trim());
  assert.ok(heroThemeSelectors.length >= 4);
  assert.ok(heroThemeSelectors.every((selector) => selector.includes(".hero-scene[data-time-theme=")));
  assert.match(landing, /const refreshDate = \(\) => setCurrentDate\(new Date\(\)\)/);
  assert.match(landing, /window\.setInterval\(refreshDate, 60_000\)/);
  assert.match(landing, /handleHeroPointerMove/);
  assert.match(landing, /\(pointer: coarse\)/);
  assert.match(landing, /prefers-reduced-motion: reduce/);
  assert.match(landing, /<section className="moments-section"[\s\S]*?<div className="quiet-transition"[\s\S]*?<\/section>/);
  assert.match(landing, /moment-rise[\s\S]*?01 <span>· INTENTION<\/span>[\s\S]*?<h3>Rise<\/h3>[\s\S]*?Begin with intention/);
  assert.match(landing, /moment-build[\s\S]*?02 <span>· STRENGTH<\/span>[\s\S]*?<h3>Build<\/h3>/);
  assert.match(landing, /moment-learn[\s\S]*?03 <span>· CURIOSITY<\/span>[\s\S]*?<h3>Learn<\/h3>/);
  assert.match(landing, /moment-still[\s\S]*?04 <span>· STILLNESS<\/span>[\s\S]*?<h3>Be Still<\/h3>/);
  assert.match(landing, /<section className="promise-section"[\s\S]*?className="promise-content"[\s\S]*?Make My Promise[\s\S]*?<\/section>[\s\S]*?<section className="personal-ending-section"[\s\S]*?className="creator-story"[\s\S]*?creator-signature[\s\S]*?className="final-section"[\s\S]*?Begin Your Winter Arc[\s\S]*?<\/section>/);
  assert.equal([...landing.matchAll(/<section className="promise-section"/g)].length, 1);
  assert.equal([...landing.matchAll(/<section className="personal-ending-section"/g)].length, 1);
  assert.doesNotMatch(landing, /<section className="creator-story"|<section className="final-section"/);
  assert.match(css, /\.landing-main\s*\{[^}]*background:[^}]*#f5f0e7/s);
  assert.match(css, /\.connection-rest-section\s*\{[^}]*radial-gradient/s);
  assert.match(css, /\.idea-section\s*\{[^}]*radial-gradient/s);
  assert.match(css, /\.moments-grid\s*\{[^}]*grid-template-columns: 1fr/s);
  const momentsSectionStyles = css.match(/\.moments-section\s*\{([^}]*)\}/s)?.[1] || "";
  assert.match(momentsSectionStyles, /padding: clamp\(52px, 7vw, 78px\) 24px/);
  assert.match(momentsSectionStyles, /display: flex/);
  assert.doesNotMatch(momentsSectionStyles, /min-height: 100(?:svh|vh)/);
  assert.match(css, /\.moments-grid\s*\{[^}]*grid-template-rows: repeat\(4,/s);
  assert.match(css, /\.moment\s*\{[^}]*min-height: clamp\(82px, 11\.5vh, 108px\)[^}]*display: flex[^}]*align-items: center/s);
  assert.match(css, /\.promise-light\s*\{[^}]*position: relative[^}]*margin: 0 auto 24px/s);
  assert.match(css, /\.promise-section\s*\{[^}]*radial-gradient/s);
  assert.match(css, /\.promise-section\s*\{[^}]*rgba\(85, 137, 96, \.78\)[^}]*rgba\(111, 126, 157, \.74\)[^}]*#485b52/s);
  assert.match(css, /\.promise-section\s*\{[^}]*rgba\(241, 211, 154, \.42\)/s);
  assert.match(css, /\.promise-section::before\s*\{[^}]*rgba\(255, 227, 170, \.23\)/s);
  assert.match(css, /\.promise-number\s*\{[^}]*#e6c578[^}]*text-shadow: 0 0 34px/s);
  assert.match(css, /\.personal-ending-section\s*\{[^}]*radial-gradient/s);
  assert.match(css, /\.personal-ending-section\s*\{[^}]*rgba\(225, 167, 147, \.72\)[^}]*rgba\(166, 104, 90, \.48\)[^}]*rgba\(250, 232, 203, \.84\)[^}]*#ead8ca/s);
  assert.match(css, /\.ending-transition-star\s*\{[^}]*text-shadow: 0 0 16px/s);
  assert.match(css, /\.ending-transition-star\s*\{[^}]*margin: 8px auto 4px/s);
  assert.match(css, /\.final-section\s*\{[^}]*margin: clamp\(10px, 1\.5vw, 14px\) auto 0/s);
  assert.match(css, /\.personal-ending-section::after\s*\{[^}]*height: 96px[^}]*radial-gradient/s);
  assert.match(css, /\.friends-panel\s*\{[^}]*rgba\(229, 191, 132, \.7\)[^}]*rgba\(204, 139, 126, \.55\)[^}]*box-shadow/s);
  assert.match(css, /\.sleep-panel\s*\{[^}]*rgba\(137, 175, 148, \.54\)[^}]*rgba\(169, 166, 204, \.48\)[^}]*box-shadow/s);
  assert.match(css, /\.moment-rise\s*\{[^}]*#3e6251/s);
  assert.match(css, /\.moment-build\s*\{[^}]*#593a34/s);
  assert.match(css, /\.moment-learn\s*\{[^}]*#294c3c/s);
  assert.match(css, /\.moment-still\s*\{[^}]*#26394d/s);
  assert.match(css, /\.idea-section\s*\{[^}]*rgba\(101, 128, 79, \.86\)[^}]*rgba\(166, 108, 83, \.8\)[^}]*#777257/s);
  assert.match(css, /\.personal-ending-section\s*\{[^}]*rgba\(225, 167, 147, \.72\)[^}]*radial-gradient/s);
  assert.match(css, /\.final-section\s*\{[^}]*background: radial-gradient\(ellipse at 50% 44%/s);
  assert.match(css, /\.final-section\s*\{[^}]*border: 0/);
  assert.match(landing, /className="ending-transition-star"[\s\S]*?className="final-section"/);
  assert.match(landing, /className="final-section"[\s\S]*?A NEW SEASON, ONE DAY AT A TIME[\s\S]*?Your winter<br \/><em>starts here\.<\/em>[\s\S]*?The person you’re becoming is waiting\.[\s\S]*?Begin Your Winter Arc[\s\S]*?<span aria-hidden="true">→<\/span>/);
  assert.doesNotMatch(landing, /<hr\b/);
  assert.match(landing, /The person you’re becoming is waiting\./);
  assert.doesNotMatch(css, /\.connection-rest-section,[\s\S]*?\.personal-ending-section \{ height: auto; min-height: 100vh; min-height: 100svh;/);
  assert.doesNotMatch(css, /Mobile chapters are composed as single, viewport-height scenes/);
  assert.match(css, /\.idea-section::before \{ position: absolute; z-index: -1; top: 50%; left: 50%; width: min\(70vw, 720px\)/);
  assert.match(landing, /new IntersectionObserver/);
  assert.match(css, /\.landing-v2\.motion-ready \[data-reveal\]\.is-visible/);
  assert.match(css, /\.landing-v2\.motion-ready \[data-reveal\],\s*\.landing-v2\.motion-ready \[data-reveal\]\.is-visible \{ opacity: 1 !important; transform: none !important;/);
});
