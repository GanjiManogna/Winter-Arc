import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppHeader from "./AppHeader";
import {
  getDaySnapshotFromProgress,
  getHistoryOverviewFromProgress,
  getRecordedDatesFromProgress,
  loadProgress,
  toISODate,
} from "../data/storage";
import { getAccountDataMode } from "../data/accountDataMode.js";
import { useAccountDataLifecycle } from "../data/useAccountDataLifecycle.js";
import AccountDataNotice, { AccountDataLoading } from "./AccountDataNotice.jsx";
import {
  isMeasurableRitual,
  isInformationalRitual,
  isRangeRitual,
  isTargetRitual,
  toNumericValue,
} from "../data/ritualStatus";
import "./HistoryPage.css";

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function shiftMonth(year, month, delta) {
  const next = new Date(year, month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

function formatDayHeading(iso) {
  return parseLocalIso(iso)
    .toLocaleDateString("en-US", {
      month: "long",
      day: "2-digit",
    })
    .toUpperCase();
}

function parseLocalIso(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function historyMark(ritual, status) {
  if (isInformationalRitual(ritual)) return status.value > 0 ? "·" : "—";
  if (isMeasurableRitual(ritual)) {
    if (status.completed) return "✓";
    if (status.inProgress) return "◐";
    return "—";
  }
  return status.completed ? "✓" : "○";
}

function formatAmount(value) {
  return toNumericValue(value).toLocaleString(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });
}

function formatSleepDuration(hours) {
  const totalMinutes = Math.round(toNumericValue(hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function historyValue(ritual, status) {
  if (isRangeRitual(ritual)) {
    if (status.value <= 0) return "";
    return formatSleepDuration(status.value);
  }
  if (isTargetRitual(ritual)) {
    if (status.value <= 0) return "";
    return `${formatAmount(status.value)} / ${ritual.goal.toLocaleString()} ${ritual.unit || ""}`.trim();
  }
  return "";
}

function HistoryPage() {
  const account = useAccountDataLifecycle();
  const mode = getAccountDataMode(account.status);
  if (mode === "loading") {
    return (
      <main className="history-page">
        <AppHeader />
        <AccountDataLoading />
      </main>
    );
  }

  const progress = mode === "cloud-read-only" ? account.progress : loadProgress();
  return (
    <HistoryContent
      key={account.identityKey}
      progress={progress}
      mode={mode}
      error={account.error}
      onRetry={account.retry}
    />
  );
}

function HistoryContent({ progress, mode, error, onRetry }) {
  const today = toISODate();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [openIso, setOpenIso] = useState(today);
  const [, setRefreshVersion] = useState(0);

  useEffect(() => {
    document.title = "History · Winter Arc";
    const sync = () => setRefreshVersion((current) => current + 1);
    if (mode !== "cloud-read-only") {
      window.addEventListener("focus", sync);
      window.addEventListener("winter-arc-progress", sync);
    }
    return () => {
      document.title = "winter-arc";
      window.removeEventListener("focus", sync);
      window.removeEventListener("winter-arc-progress", sync);
    };
  }, [mode]);

  const currentProgress = mode === "cloud-read-only" ? progress : loadProgress();
  const dates = getRecordedDatesFromProgress(currentProgress);
  const overview = getHistoryOverviewFromProgress(currentProgress);

  const monthDates = useMemo(
    () =>
      dates.filter((iso) => {
        const date = parseLocalIso(iso);
        return date.getFullYear() === cursor.year && date.getMonth() === cursor.month;
      }),
    [dates, cursor]
  );

  const snapshots = useMemo(
    () => monthDates.map((iso) => getDaySnapshotFromProgress(currentProgress, iso)),
    [monthDates, currentProgress]
  );

  const expandedIso =
    openIso === ""
      ? ""
      : monthDates.includes(openIso)
        ? openIso
        : monthDates[0] || "";

  return (
    <main className="history-page">
      <div className="history-atmosphere" aria-hidden="true">
        <svg viewBox="0 0 360 300" fill="none" focusable="false">
          <path d="M86 46h157l42 42v165H86z" />
          <path d="M243 46v43h42M111 116h146M111 143h112M111 170h129" />
          <path d="M59 77v156m-8-135h16m-16 42h16m-16 42h16m-16 42h16" strokeDasharray="2 5" />
          <circle cx="67" cy="92" r="3" fill="currentColor" />
          <circle cx="67" cy="134" r="3" fill="currentColor" />
          <circle cx="67" cy="176" r="3" fill="currentColor" />
          <path d="M111 199h82m-82 15h101" />
        </svg>
      </div>
      <AppHeader />
      <AccountDataNotice mode={mode} error={error} onRetry={onRetry} />

      <header className="history-hero">
        <p className="history-kicker">YOUR WINTER ARC</p>
        <h1>
          Look back without judgement.
          <em>Notice how far you've come.</em>
        </h1>
        <p className="history-lede">
          A quieter archive of the days you kept.
        </p>

        <div className="history-stats">
          <div>
            <strong>{String(overview.currentDay).padStart(2, "0")}</strong>
            <span>Current day</span>
          </div>
          <div>
            <strong>{overview.recordedDays}</strong>
            <span>Days recorded</span>
          </div>
          <div>
            <strong>{overview.daysWithCompletion}</strong>
            <span>Days with a kept promise</span>
          </div>
        </div>
      </header>

      {dates.length === 0 ? (
        <section className="history-empty">
          <p className="history-kicker">YOUR JOURNEY HASN'T BEEN RECORDED YET.</p>
          <h2>Your days will appear here as you begin.</h2>
          <Link className="history-return" to="/today">
            Return to Today
          </Link>
        </section>
      ) : (
        <>
          <nav className="history-month" aria-label="Month">
            <button
              type="button"
              onClick={() => setCursor((current) => shiftMonth(current.year, current.month, -1))}
            >
              ‹ Previous
            </button>
            <strong>{monthLabel(cursor.year, cursor.month)}</strong>
            <button
              type="button"
              onClick={() => setCursor((current) => shiftMonth(current.year, current.month, 1))}
            >
              Next ›
            </button>
          </nav>

          {snapshots.length === 0 ? (
            <p className="history-quiet">No recorded days yet.</p>
          ) : (
            <div className="history-timeline">
              {snapshots.map((snapshot) => {
                const expanded = expandedIso === snapshot.iso;
                const progress = snapshot.total
                  ? (snapshot.completedCount / snapshot.total) * 100
                  : 0;

                return (
                  <article
                    key={snapshot.iso}
                    className={`history-day ${expanded ? "is-open" : ""}`}
                  >
                    <button
                      type="button"
                      className="history-day-toggle"
                      onClick={() => setOpenIso(expanded ? "" : snapshot.iso)}
                      aria-expanded={expanded}
                    >
                      <div>
                        <p>
                          {formatDayHeading(snapshot.iso)}
                          <span> · DAY {String(snapshot.dayNumber).padStart(2, "0")}</span>
                        </p>
                        <strong>
                          {snapshot.completedCount} / {snapshot.total} completed
                        </strong>
                      </div>
                      <span className="history-chevron">{expanded ? "↑" : "↓"}</span>
                    </button>

                    <div className="history-day-track">
                      <div style={{ width: `${progress}%` }} />
                    </div>

                    {expanded ? (
                      <ul className="history-rows">
                        {snapshot.rows.map(({ ritual, status }) => {
                          const mark = historyMark(ritual, status);
                          const value = historyValue(ritual, status);

                          return (
                            <li key={ritual.id}>
                              <span className="history-row-title">{ritual.title}</span>
                              <span className="history-row-value">{value}</span>
                              <span
                                className={`history-row-mark ${status.inProgress ? "is-progress" : ""} ${status.completed ? "is-complete" : ""}`}
                              >
                                {mark}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default HistoryPage;
