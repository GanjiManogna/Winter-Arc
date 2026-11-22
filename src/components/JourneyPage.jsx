import { useEffect, useRef, useState } from "react";
import AppHeader from "./AppHeader";
import { getDailyAnalysisFromProgress, analysisMark, analysisValue } from "../data/dailyAnalysis.js";
import { getWeeklyCheckinFromProgress, getWeekStartIsoFromProgress, shiftWeekFromProgress } from "../data/weeklyAnalysis.js";
import {
  getMonthlyIntentionFromProgress,
  getWeeklyReflectionFromProgress,
  ARC_DURATION_DAYS,
  loadProgress,
  saveMonthlyIntention,
  saveWeeklyReflection,
  toISODate,
} from "../data/storage.js";
import { getMonthlyAnalysisFromProgress, getMonthKey, shiftMonth } from "../data/monthlyAnalysis.js";
import { isTargetRitual } from "../data/ritualStatus";
import { getAccountDataMode } from "../data/accountDataMode.js";
import { useAccountDataLifecycle } from "../data/useAccountDataLifecycle.js";
import { saveMonthlyReflectionToCloud, saveWeeklyReflectionToCloud } from "../data/reflectionWriteService.js";
import AccountDataNotice, { AccountDataLoading } from "./AccountDataNotice.jsx";
import "./JourneyPage.css";

function formatLongDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

function formatAmount(value) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });
}

function formatPeriodRange(startISO, endISO) {
  if (!startISO || !endISO) return "No dates in this Arc period";
  const [startYear, startMonth, startDay] = startISO.split("-").map(Number);
  const [endYear, endMonth, endDay] = endISO.split("-").map(Number);
  const startMonthLabel = new Date(startYear, startMonth - 1, startDay).toLocaleDateString("en-US", { month: "short" });
  const endMonthLabel = new Date(endYear, endMonth - 1, endDay).toLocaleDateString("en-US", { month: "short" });
  const startLabel = String(startDay).padStart(2, "0");
  const endLabel = String(endDay).padStart(2, "0");
  if (startYear === endYear && startMonth === endMonth) return `${startMonthLabel} ${startLabel}–${endLabel}`;
  if (startYear === endYear) return `${startMonthLabel} ${startLabel}–${endMonthLabel} ${endLabel}`;
  return `${startMonthLabel} ${startLabel}, ${startYear}–${endMonthLabel} ${endLabel}, ${endYear}`;
}

function JourneyPage() {
  const account = useAccountDataLifecycle();
  const mode = getAccountDataMode(account.status);
  if (mode === "loading") {
    return (
      <main className="journey-page">
        <AppHeader />
        <AccountDataLoading />
      </main>
    );
  }

  const progress = mode === "cloud-read-only" ? account.progress : loadProgress();
  return (
    <JourneyContent
      key={account.identityKey}
      progress={progress}
      mode={mode}
      error={account.error}
      onRetry={account.retry}
      account={account}
    />
  );
}

function JourneyContent({ progress, mode, error, onRetry, account }) {
  const cloudMode = mode === "cloud-read-only";
  const [iso, setIso] = useState(() => toISODate());
  const [weekStart, setWeekStart] = useState(null);
  const [notesDraft, setNotesDraft] = useState(null);
  const [monthKey, setMonthKey] = useState(() => getMonthKey());
  const [openSection, setOpenSection] = useState(null);
  const [intentionDraft, setIntentionDraft] = useState(null);
  const [weeklySaveState, setWeeklySaveState] = useState({ key: null, status: "idle", message: "" });
  const [monthlySaveState, setMonthlySaveState] = useState({ key: null, status: "idle", message: "" });
  const weeklyWriteQueue = useRef(Promise.resolve());
  const monthlyWriteQueue = useRef(Promise.resolve());
  const weeklyInFlightByKey = useRef(new Map());
  const monthlyInFlightByKey = useRef(new Map());
  const weeklyLastSavedByKey = useRef(new Map());
  const monthlyLastSavedByKey = useRef(new Map());
  const weeklyRequestVersion = useRef(0);
  const monthlyRequestVersion = useRef(0);
  const weeklyRevisionByKey = useRef({});
  const monthlyRevisionByKey = useRef({});
  const [, setRefreshVersion] = useState(0);
  const currentProgress = cloudMode ? progress : loadProgress();
  const activeWeekStart = weekStart || getWeekStartIsoFromProgress(currentProgress);
  const analysis = getDailyAnalysisFromProgress(currentProgress, iso);
  const week = getWeeklyCheckinFromProgress(currentProgress, activeWeekStart);
  const month = getMonthlyAnalysisFromProgress(currentProgress, monthKey);
  const storedNotes = getWeeklyReflectionFromProgress(currentProgress, activeWeekStart);
  const notes = notesDraft?.weekStart === activeWeekStart ? notesDraft.value : storedNotes;
  const storedIntention = getMonthlyIntentionFromProgress(currentProgress, monthKey);
  const intention = intentionDraft?.monthKey === monthKey ? intentionDraft.value : storedIntention;

  useEffect(() => {
    document.title = "Journey · Winter Arc";
    const sync = () => setRefreshVersion((current) => current + 1);
    if (!cloudMode) {
      window.addEventListener("focus", sync);
      window.addEventListener("winter-arc-progress", sync);
    }
    return () => {
      document.title = "winter-arc";
      window.removeEventListener("focus", sync);
      window.removeEventListener("winter-arc-progress", sync);
    };
  }, [cloudMode]);

  const persistWeekly = (value, key = activeWeekStart) => {
    const serialized = JSON.stringify(value);
    const inFlight = weeklyInFlightByKey.current.get(key);
    if (inFlight?.serialized === serialized) return inFlight.promise;
    if (!inFlight && weeklyLastSavedByKey.current.get(key) === serialized) return Promise.resolve();
    if (!cloudMode) {
      try {
        saveWeeklyReflection(key, value);
        weeklyLastSavedByKey.current.set(key, serialized);
        setWeeklySaveState({ key, status: "saved", message: "Saved" });
      } catch {
        setWeeklySaveState({ key, status: "error", message: "Couldn't save this reflection. Please try again." });
      }
      return Promise.resolve();
    }
    const owner = { userId: account.userId, programId: account.programId };
    const requestVersion = ++weeklyRequestVersion.current;
    setWeeklySaveState({ key, status: "saving", message: "Saving…" });
    const save = async () => {
      if (!Object.hasOwn(weeklyRevisionByKey.current, key)) {
        weeklyRevisionByKey.current[key] = currentProgress.weeklyReflections?.[key]?.revision ?? null;
      }
      const result = await saveWeeklyReflectionToCloud({
        expectedUserId: owner.userId,
        expectedProgramId: owner.programId,
        weekStart: key,
        reflection: value,
        expectedRevision: weeklyRevisionByKey.current[key],
      });
      if (result.error) {
        if (result.error.code === "AUTHENTICATION_CHANGED" || result.error.code === "PROGRAM_CHANGED") onRetry(owner.userId);
        if (result.error.code === "CONFLICT") {
          const refreshed = await account.refresh(owner.userId);
          const confirmed = refreshed?.progress?.weeklyReflections?.[key] || { wins: "", challenges: "", focus: "", revision: null };
          weeklyRevisionByKey.current[key] = confirmed.revision ?? null;
          if (requestVersion === weeklyRequestVersion.current) {
            const latestNotes = { wins: confirmed.wins || "", challenges: confirmed.challenges || "", focus: confirmed.focus || "" };
            setNotesDraft({ weekStart: key, value: latestNotes });
            setWeeklySaveState({ key, status: "conflict", message: "Newer progress was found on another device. The latest reflection is shown; make another change to save it." });
          }
          return;
        }
        if (requestVersion === weeklyRequestVersion.current) setWeeklySaveState({ key, status: "error", message: result.error.message });
        return;
      }
      weeklyRevisionByKey.current[key] = result.data.revision ?? null;
      const applied = account.applyWeeklyReflection({ ...owner, weekStart: key, reflection: result.data });
      if (!applied) {
        onRetry(owner.userId);
        if (requestVersion === weeklyRequestVersion.current) setWeeklySaveState({ key, status: "error", message: "Your account changed while saving. Reload your account data and try again." });
        return;
      }
      const confirmed = { wins: result.data.wins, challenges: result.data.challenges, focus: result.data.focus };
      weeklyLastSavedByKey.current.set(key, JSON.stringify(confirmed));
      if (requestVersion === weeklyRequestVersion.current) {
        setNotesDraft({ weekStart: key, value: confirmed });
        setWeeklySaveState({ key, status: "saved", message: "Saved" });
      }
    };
    const pending = weeklyWriteQueue.current.then(save, save).catch(() => {
      if (requestVersion === weeklyRequestVersion.current) {
        setWeeklySaveState({ key, status: "error", message: "Couldn't save this reflection. Please try again." });
      }
    });
    weeklyWriteQueue.current = pending;
    const pendingEntry = { serialized, promise: pending };
    weeklyInFlightByKey.current.set(key, pendingEntry);
    void pending.finally(() => {
      if (weeklyInFlightByKey.current.get(key) === pendingEntry) weeklyInFlightByKey.current.delete(key);
    });
    return pending;
  };

  const persistMonthly = (value, key = monthKey) => {
    const serialized = String(value.intention ?? "");
    const inFlight = monthlyInFlightByKey.current.get(key);
    if (inFlight?.serialized === serialized) return inFlight.promise;
    if (!inFlight && monthlyLastSavedByKey.current.get(key) === serialized) return Promise.resolve();
    if (!cloudMode) {
      try {
        saveMonthlyIntention(key, value.intention);
        monthlyLastSavedByKey.current.set(key, serialized);
        setMonthlySaveState({ key, status: "saved", message: "Saved" });
      } catch {
        setMonthlySaveState({ key, status: "error", message: "Couldn't save this reflection. Please try again." });
      }
      return Promise.resolve();
    }
    const owner = { userId: account.userId, programId: account.programId };
    const requestVersion = ++monthlyRequestVersion.current;
    setMonthlySaveState({ key, status: "saving", message: "Saving…" });
    const save = async () => {
      if (!Object.hasOwn(monthlyRevisionByKey.current, key)) {
        monthlyRevisionByKey.current[key] = currentProgress.monthlyReflections?.[key]?.revision ?? null;
      }
      const result = await saveMonthlyReflectionToCloud({
        expectedUserId: owner.userId,
        expectedProgramId: owner.programId,
        month: key,
        intention: value.intention,
        expectedRevision: monthlyRevisionByKey.current[key],
      });
      if (result.error) {
        if (result.error.code === "AUTHENTICATION_CHANGED" || result.error.code === "PROGRAM_CHANGED") onRetry(owner.userId);
        if (result.error.code === "CONFLICT") {
          const refreshed = await account.refresh(owner.userId);
          const confirmed = refreshed?.progress?.monthlyReflections?.[key] || { intention: "", revision: null };
          monthlyRevisionByKey.current[key] = confirmed.revision ?? null;
          if (requestVersion === monthlyRequestVersion.current) {
            setIntentionDraft({ monthKey: key, value: confirmed.intention || "" });
            setMonthlySaveState({ key, status: "conflict", message: "A newer intention was found on another device. The latest reflection is shown; make another change to save it." });
          }
          return;
        }
        if (requestVersion === monthlyRequestVersion.current) setMonthlySaveState({ key, status: "error", message: result.error.message });
        return;
      }
      monthlyRevisionByKey.current[key] = result.data.revision ?? null;
      const applied = account.applyMonthlyReflection({ ...owner, month: key, reflection: result.data });
      if (!applied) {
        onRetry(owner.userId);
        if (requestVersion === monthlyRequestVersion.current) setMonthlySaveState({ key, status: "error", message: "Your account changed while saving. Reload your account data and try again." });
        return;
      }
      if (requestVersion === monthlyRequestVersion.current) {
        setIntentionDraft({ monthKey: key, value: result.data.intention });
        monthlyLastSavedByKey.current.set(key, result.data.intention);
        setMonthlySaveState({ key, status: "saved", message: "Saved" });
      }
    };
    const pending = monthlyWriteQueue.current.then(save, save).catch(() => {
      if (requestVersion === monthlyRequestVersion.current) {
        setMonthlySaveState({ key, status: "error", message: "Couldn't save this reflection. Please try again." });
      }
    });
    monthlyWriteQueue.current = pending;
    const pendingEntry = { serialized, promise: pending };
    monthlyInFlightByKey.current.set(key, pendingEntry);
    void pending.finally(() => {
      if (monthlyInFlightByKey.current.get(key) === pendingEntry) monthlyInFlightByKey.current.delete(key);
    });
    return pending;
  };

  const goWeek = (delta) => {
    void persistWeekly(notes, activeWeekStart);
    const next = shiftWeekFromProgress(currentProgress, activeWeekStart, delta);
    setWeekStart(next);
    setNotesDraft(null);
  };

  const goMonth = (delta) => {
    void persistMonthly({ intention }, monthKey);
    const nextMonth = shiftMonth(monthKey, delta);
    setMonthKey(nextMonth);
    setIntentionDraft(null);
  };

  const updateIntention = (value) => {
    setIntentionDraft({ monthKey, value });
    if (!cloudMode) {
      saveMonthlyIntention(monthKey, value);
      monthlyLastSavedByKey.current.set(monthKey, String(value ?? ""));
      setMonthlySaveState({ key: monthKey, status: "saved", message: "Saved" });
    } else {
      setMonthlySaveState({ key: monthKey, status: "dirty", message: "Unsaved changes" });
    }
  };

  const updateWeeklyNote = (field, value) => {
    setNotesDraft({ weekStart: activeWeekStart, value: { ...notes, [field]: value } });
    setWeeklySaveState({ key: activeWeekStart, status: "dirty", message: "Unsaved changes" });
  };

  const { snapshot, recorded, percent, reflection, sleep, wentWell } = analysis;
  const todayIso = toISODate();
  const currentMonth = monthKey === getMonthKey(new Date());

  return (
    <main className="journey-page">
      <div className="journey-atmosphere" aria-hidden="true">
        <svg viewBox="0 0 520 360" fill="none" focusable="false">
          <path d="M30 290c91-11 122-119 222-130 96-11 124 85 238 40" />
          <path d="M35 314c102-11 137-122 231-135 99-13 127 81 228 42" strokeDasharray="2 10" />
          <circle cx="85" cy="277" r="4" /><circle cx="169" cy="205" r="4" />
          <circle cx="252" cy="165" r="5" /><circle cx="338" cy="183" r="4" />
          <circle cx="424" cy="213" r="4" /><circle cx="481" cy="200" r="3" />
          <path d="M78 267v20m-10-10h20m260-119v16m-8-8h16m82-61v14m-7-7h14" />
        </svg>
      </div>
      <AppHeader />
      <AccountDataNotice mode={mode} error={error} onRetry={onRetry} />

      <header className="journey-hero">
        <p className="journey-kicker">THE {ARC_DURATION_DAYS} DAYS</p>
        <h1>
          Today's
          <em>Journey</em>
        </h1>
        <p className="journey-lede">
          Not a score. A reflection of what you kept, and what can wait.
        </p>
      </header>

      <section className="analysis-card">
        <nav className="analysis-nav" aria-label="Day">
          <button type="button" onClick={() => setIso(analysis.previousIso)}>
            ‹ Previous
          </button>
          <strong>{iso === todayIso ? "Today" : formatLongDate(iso)}</strong>
          <button
            type="button"
            onClick={() => setIso(analysis.nextIso)}
            disabled={iso === todayIso}
          >
            Next ›
          </button>
        </nav>

        {!recorded ? (
          <div className="analysis-empty">
            <p className="journey-kicker">NOTHING RECORDED YET.</p>
            <h2>Your reflection will appear here as you move through your day.</h2>
          </div>
        ) : (
          <>
            <div className="analysis-summary">
              <p className="journey-kicker">
                DAY {String(snapshot.dayNumber).padStart(2, "0")}
              </p>
              <h2>{formatLongDate(iso)}</h2>
              <p>
                {snapshot.completedCount} of {snapshot.total} rituals completed
              </p>
              <p className="analysis-percent">
                {percent}% of today's rituals
              </p>
              <div className="analysis-track">
                <div style={{ width: `${percent}%` }} />
              </div>
            </div>

            <div className="analysis-block">
              <p className="journey-kicker">THE DAY</p>
              <ul className="analysis-rows">
                {snapshot.rows.map(({ ritual, status }) => (
                  <li key={ritual.id}>
                    <span>{ritual.title}</span>
                    <span className="analysis-value">{analysisValue(ritual, status)}</span>
                    <span
                      className={`analysis-mark ${status.inProgress ? "is-progress" : ""} ${status.completed ? "is-complete" : ""}`}
                    >
                      {analysisMark(ritual, status)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="analysis-block">
              <p className="journey-kicker">A GENTLE REFLECTION</p>
              <p className="analysis-prose">{reflection.message}</p>
              {reflection.notes.map((note) => (
                <p className="analysis-prose" key={note}>{note}</p>
              ))}
            </div>

            <div className="analysis-block">
              <p className="journey-kicker">SLEEP</p>
              <p className="analysis-prose">{sleep}</p>
            </div>

            {wentWell.length > 0 ? (
              <div className="analysis-block">
                <p className="journey-kicker">WHAT WENT WELL</p>
                <ul className="analysis-well">
                  {wentWell.map(({ ritual }) => (
                    <li key={ritual.id}>✓ {ritual.title}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="analysis-block">
              <p className="journey-kicker">FOR TOMORROW</p>
              <p className="analysis-prose">{reflection.tomorrow}</p>
            </div>
          </>
        )}
      </section>

      <section className="journey-accordion">
        <button
          className="journey-accordion-trigger"
          type="button"
          aria-expanded={openSection === "week"}
          aria-controls="journey-week-details"
          onClick={() => setOpenSection((current) => current === "week" ? null : "week")}
        >
          <span className="journey-accordion-heading"><span>This Week</span></span>
          <span className="journey-accordion-period">
            <strong>Week {week.weekNumber}</strong>
            <span>{formatPeriodRange(week.weekStartIso, week.weekEndIso)}</span>
          </span>
          <span className="journey-accordion-chevron" aria-hidden="true">›</span>
        </button>
        <div id="journey-week-details" className="journey-accordion-panel" hidden={openSection !== "week"}>
      <section className="analysis-card week-card">
        <nav className="analysis-nav" aria-label="Week">
          <button
            type="button"
            onClick={() => goWeek(-1)}
            disabled={week.previousWeek === week.weekStartIso}
          >
            ‹ Previous
          </button>
          <strong>
            {week.isCurrent ? "This week" : `Week ${String(week.weekNumber).padStart(2, "0")}`}
          </strong>
          <button
            type="button"
            onClick={() => goWeek(1)}
            disabled={week.nextWeek === week.weekStartIso}
          >
            Next ›
          </button>
        </nav>

        <div className="analysis-summary">
          <p className="journey-kicker">
            WEEK {String(week.weekNumber).padStart(2, "0")}
            {week.isCurrent ? " · CURRENT WEEK" : ""}
          </p>
          <h2>{week.rangeLabel}</h2>
        </div>

        {week.recordedDays === 0 ? (
          <div className="analysis-empty">
            <p className="journey-kicker">NO RECORDED DAYS YET.</p>
            <h2>This week is still waiting to be written.</h2>
          </div>
        ) : (
          <>
            <div className="week-overview">
              <div>
                <strong>{week.daysInWeek}</strong>
                <span>Days</span>
              </div>
              <div>
                <strong>{week.recordedDays}</strong>
                <span>Days recorded</span>
              </div>
              <div>
                <strong>{week.totalCompleted}</strong>
                <span>Rituals completed</span>
              </div>
              <div>
                <strong>{week.averagePercent}%</strong>
                <span>Avg daily completion</span>
              </div>
            </div>

            <div className="analysis-block">
              <p className="journey-kicker">HABIT PATTERNS</p>
              <ul className="week-patterns">
                {week.patterns.map((pattern) => (
                  <li key={pattern.ritual.id}>
                    <div className="week-pattern-top">
                      <strong>{pattern.ritual.title}</strong>
                      <span>
                        {pattern.ritual.id === "sleep-tracker"
                          ? `${pattern.recordedValues} ${pattern.recordedValues === 1 ? "night" : "nights"} recorded`
                          : `${pattern.completedDays} / ${pattern.days.filter((day) => !day.future).length} days`}
                      </span>
                    </div>
                    <p className="week-dots" aria-hidden="true">
                      {pattern.days.map((day) => (
                        <span key={day.iso} className={day.future ? "is-future" : ""}>
                          {day.future ? "·" : day.mark}
                        </span>
                      ))}
                    </p>
                    {isTargetRitual(pattern.ritual) && pattern.recordedValues > 0 ? (
                      <p className="week-metric">
                        Average: {formatAmount(pattern.averageValue)} {pattern.ritual.unit}
                        {pattern.ritual.goal ? ` / ${pattern.ritual.goal.toLocaleString()} ${pattern.ritual.unit}` : ""}
                        <br />
                        Target reached: {pattern.completedDays} / {pattern.days.filter((day) => !day.future).length} days
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            <div className="analysis-block">
              <p className="journey-kicker">SLEEP</p>
              {week.sleep.recorded ? (
                <>
                  <p className="analysis-prose">
                    Average: {formatAmount(week.sleep.average)} hours
                  </p>
                  <p className="analysis-prose">
                    Sleep recorded: {week.sleep.recorded} {week.sleep.recorded === 1 ? "night" : "nights"}
                  </p>
                  <p className="analysis-prose">{week.sleep.note}</p>
                </>
              ) : (
                <p className="analysis-prose">{week.sleep.note}</p>
              )}
            </div>

            <div className="analysis-block">
              <p className="journey-kicker">THIS WEEK'S WINS</p>
              {week.wins.length ? (
                <ul className="analysis-well">
                  {week.wins.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="analysis-prose">
                  Small showings still belong here. Keep returning.
                </p>
              )}
            </div>

            <div className="analysis-block">
              <p className="journey-kicker">WHAT FELT HARD</p>
              {week.challenges.map((item) => (
                <p className="analysis-prose" key={item}>{item}</p>
              ))}
            </div>

            <div className="analysis-block">
              <p className="journey-kicker">FOCUS FOR NEXT WEEK</p>
              <p className="analysis-prose">{week.focus}</p>
            </div>
          </>
        )}

        <div className="analysis-block">
          <p className="journey-kicker">YOUR NOTES</p>
          <label className="week-note">
            What felt good this week?
            <textarea
              value={notes.wins}
              onChange={(event) => updateWeeklyNote("wins", event.target.value)}
              onBlur={() => { void persistWeekly(notes, activeWeekStart); }}
              rows={3}
            />
          </label>
          <label className="week-note">
            What felt difficult?
            <textarea
              value={notes.challenges}
              onChange={(event) => updateWeeklyNote("challenges", event.target.value)}
              onBlur={() => { void persistWeekly(notes, activeWeekStart); }}
              rows={3}
            />
          </label>
          <label className="week-note">
            What would you like to carry into next week?
            <textarea
              value={notes.focus}
              onChange={(event) => updateWeeklyNote("focus", event.target.value)}
              onBlur={() => { void persistWeekly(notes, activeWeekStart); }}
            rows={3}
          />
          </label>
          <button
            className="reflection-save-button"
            type="button"
            disabled={weeklySaveState.key === activeWeekStart && weeklySaveState.status === "saving"}
            onClick={() => { void persistWeekly(notes, activeWeekStart); }}
          >
            {weeklySaveState.key === activeWeekStart && weeklySaveState.status === "saving" ? "Saving…" : "Save reflection"}
          </button>
          {weeklySaveState.key === activeWeekStart && weeklySaveState.status !== "idle" ? (
            <p className="analysis-prose" role={weeklySaveState.status === "error" ? "alert" : "status"}>
              {weeklySaveState.message}{weeklySaveState.status === "error" ? (
                <button type="button" onClick={() => { void persistWeekly(notes, activeWeekStart); }}>Retry save</button>
              ) : null}
            </p>
          ) : null}
        </div>
      </section>
        </div>
      </section>

      <section className="journey-accordion">
        <button
          className="journey-accordion-trigger"
          type="button"
          aria-expanded={openSection === "month"}
          aria-controls="journey-month-details"
          onClick={() => setOpenSection((current) => current === "month" ? null : "month")}
        >
          <span className="journey-accordion-heading"><span>This Month</span></span>
          <span className="journey-accordion-period">
            <strong>{month.monthLabel}</strong>
            <span>{formatPeriodRange(month.startDate, month.endDate)}</span>
          </span>
          <span className="journey-accordion-chevron" aria-hidden="true">›</span>
        </button>
        <div id="journey-month-details" className="journey-accordion-panel" hidden={openSection !== "month"}>
      <section className="analysis-card monthly-card">
        <nav className="analysis-nav" aria-label="Month">
          <button type="button" onClick={() => goMonth(-1)}>
            ‹ Previous
          </button>
          <strong>{month.monthLabel}</strong>
          <button type="button" onClick={() => goMonth(1)}>
            Next ›
          </button>
        </nav>

        <div className="analysis-summary">
          <p className="journey-kicker">
            MONTHLY REFLECTION{currentMonth ? " · CURRENT MONTH" : ""}
          </p>
          <h2>{month.monthLabel}</h2>
        </div>

        {!month.hasRecordedData ? (
          <div className="analysis-empty">
            <p className="journey-kicker">NO RECORDED DAYS YET.</p>
            <p className="monthly-empty-days">{month.calendarDays} calendar days in {month.monthLabel}.</p>
            <h2>Your reflection will appear here as you move through the month.</h2>
          </div>
        ) : (
          <>
            <div className="monthly-overview">
              <div>
                <strong>{month.calendarDays}</strong>
                <span>Calendar days</span>
              </div>
              <div>
                <strong>{month.recordedDays}</strong>
                <span>Days recorded</span>
              </div>
              <div>
                <strong>{month.totalCompleted}</strong>
                <span>Rituals completed</span>
              </div>
              <div>
                <strong>{month.averagePercent}%</strong>
                <span>Avg completion on recorded days</span>
              </div>
            </div>

            <div className="analysis-block">
              <p className="journey-kicker">HABIT STATISTICS</p>
              <ul className="monthly-habits">
                {month.habits.map((habit) => (
                  <li key={habit.ritual.id}>
                    <div className="monthly-habit-top">
                      <strong>{habit.ritual.title}</strong>
                      <span>{habit.recordedDays} {habit.recordedDays === 1 ? "day" : "days"}</span>
                    </div>
                    <p>
                      {isTargetRitual(habit.ritual)
                        ? `Target reached: ${habit.completedDays} / ${habit.recordedDays} days`
                        : `Completed: ${habit.completedDays} / ${habit.recordedDays} recorded days`}
                    </p>
                    {isTargetRitual(habit.ritual) && habit.valueCount > 0 ? (
                      <p>
                        Average: {formatAmount(habit.averageValue)} / {habit.ritual.goal.toLocaleString()} {habit.ritual.unit}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            {month.sleep.recorded > 0 ? (
              <div className="analysis-block monthly-sleep">
                <p className="journey-kicker">SLEEP</p>
                <div className="monthly-sleep-stats">
                  <p>Average: {formatAmount(month.sleep.average)} hours</p>
                  <p>Recorded: {month.sleep.recorded} {month.sleep.recorded === 1 ? "night" : "nights"}</p>
                  <p>Range: {formatAmount(month.sleep.lowest)} — {formatAmount(month.sleep.highest)} hours</p>
                </div>
                <p className="analysis-prose">{month.sleep.note}</p>
              </div>
            ) : null}

            <div className="monthly-reflections">
              <article>
                <p className="journey-kicker">BIGGEST WIN</p>
                <p className="analysis-prose">{month.biggestWin}</p>
              </article>
              <article>
                <p className="journey-kicker">BIGGEST LESSON</p>
                <p className="analysis-prose">{month.biggestLesson}</p>
              </article>
              <article>
                <p className="journey-kicker">WHAT TO IMPROVE</p>
                <p className="analysis-prose">{month.improve}</p>
              </article>
            </div>
          </>
        )}

        <div className="analysis-block monthly-intention-block">
          <p className="journey-kicker">NEXT MONTH'S INTENTION</p>
          <label className="week-note">
            What would you like to carry into next month?
            <textarea
              value={intention}
              onChange={(event) => updateIntention(event.target.value)}
              onBlur={() => { if (cloudMode) void persistMonthly({ intention }, monthKey); }}
              placeholder="What would you like to carry into next month?"
            rows={3}
          />
          </label>
          <button
            className="reflection-save-button"
            type="button"
            disabled={monthlySaveState.key === monthKey && monthlySaveState.status === "saving"}
            onClick={() => { void persistMonthly({ intention }, monthKey); }}
          >
            {monthlySaveState.key === monthKey && monthlySaveState.status === "saving" ? "Saving…" : "Save reflection"}
          </button>
          {monthlySaveState.key === monthKey && monthlySaveState.status !== "idle" ? (
            <p className="analysis-prose" role={monthlySaveState.status === "error" ? "alert" : "status"}>
              {monthlySaveState.message}{monthlySaveState.status === "error" ? (
                <button type="button" onClick={() => { void persistMonthly({ intention }, monthKey); }}>Retry save</button>
              ) : null}
            </p>
          ) : null}
        </div>
      </section>
        </div>
      </section>
    </main>
  );
}

export default JourneyPage;
