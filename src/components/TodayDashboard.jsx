import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppHeader from "./AppHeader";
import AddHabitModal from "./AddHabitModal";
import { ARC_DURATION_DAYS, archiveCustomHabit, createCustomHabitRecord, getAllRituals, getDayNumber, getTodayEntries, isDateWithinArc, loadProgress, toISODate, updateCustomHabitDefinition } from "../data/storage.js";
import { createTodayCloudModel } from "../data/todayCloudModel.js";
import { getAccountDataMode } from "../data/accountDataMode.js";
import { useAccountDataLifecycle } from "../data/useAccountDataLifecycle.js";
import { archiveCustomHabitToCloud, saveCustomHabitToCloud, updateCustomHabitInCloud } from "../data/customHabitWriteService.js";
import { repositoryResult } from "../data/repositories/repositoryContract.js";
import { useAuth } from "../auth/useAuth.js";
import {
  getRitualStatus,
  isInformationalRitual,
  isRangeRitual,
  isTargetRitual,
  toNumericValue,
} from "../data/ritualStatus";
import {
  delayUntilNextMinute,
  getProgressMessage,
  getTimePeriod,
  personalizeGreetingHeading,
  TIME_COPY,
} from "../data/todayExperience";
import "./TodayDashboard.css";

function formatTodayLabel(date) {
  return date
    .toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "2-digit",
    })
    .toUpperCase();
}

function formatTime(date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function todayMark(status) {
  if (status.rangeState) return status.value > 0 ? "·" : "—";
  if (status.value !== null && status.value !== undefined) {
    if (status.completed) return "✓";
    if (status.inProgress) return "◐";
    return "—";
  }
  if (status.completed) return "✓";
  if (status.inProgress) return "◐";
  return "○";
}

function formatAmount(value) {
  const numeric = toNumericValue(value);
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });
}

function todayDetail(ritual, status) {
  if (isRangeRitual(ritual)) {
    if (status.rangeState === "empty" || status.value <= 0) {
      return `${ritual.goalMin}–${ritual.goalMax} ${ritual.unit}`;
    }

    const hours = formatAmount(status.value);
    if (status.rangeState === "below") {
      return `${hours} ${ritual.unit} · below the 7–9 hour reference`;
    }
    if (status.rangeState === "above") {
      return `${hours} ${ritual.unit} · above the 7–9 hour reference`;
    }
    return `${hours} ${ritual.unit} · within the 7–9 hour reference`;
  }

  if (isTargetRitual(ritual)) {
    return `${formatAmount(status.value)} / ${ritual.goal.toLocaleString()} ${ritual.unit || ""}`.trim();
  }

  return ritual.shortDescription;
}

function TodayDashboard() {
  const { displayName } = useAuth();
  const [now, setNow] = useState(() => new Date());
  const [localData, setLocalData] = useState(null);
  const [addingHabit, setAddingHabit] = useState(false);
  const [editingHabit, setEditingHabit] = useState(null);
  const [archivingHabitId, setArchivingHabitId] = useState(null);
  const [customHabitError, setCustomHabitError] = useState("");
  const [pendingCloudHabitRequest, setPendingCloudHabitRequest] = useState(null);
  const account = useAccountDataLifecycle();
  const dataMode = getAccountDataMode(account.status);
  const cloudModel = dataMode === "cloud-read-only"
    ? createTodayCloudModel(account.progress, now)
    : null;

  useEffect(() => {
    document.title = "Today · Winter Arc";
    const readLocalData = (date) => {
      setLocalData({
        entries: getTodayEntries(),
        rituals: getAllRituals(),
        dayNumber: getDayNumber(date),
        arcActive: isDateWithinArc(loadProgress(), toISODate(date)),
      });
    };
    const sync = (readLocal = true) => {
      const current = new Date();
      setNow(current);
      if (readLocal) readLocalData(current);
    };

    const localMode = dataMode !== "loading" && dataMode !== "cloud-read-only";
    if (localMode) sync();

    let timer;
    const scheduleNextMinute = () => {
      const current = new Date();
      const delay = delayUntilNextMinute(current);
      timer = setTimeout(() => {
        sync(localMode);
        scheduleNextMinute();
      }, delay);
    };
    scheduleNextMinute();
    const syncOnFocus = () => sync(localMode);
    window.addEventListener("focus", syncOnFocus);
    document.addEventListener("visibilitychange", syncOnFocus);
    if (localMode) window.addEventListener("winter-arc-progress", syncOnFocus);

    return () => {
      document.title = "winter-arc";
      clearTimeout(timer);
      window.removeEventListener("focus", syncOnFocus);
      document.removeEventListener("visibilitychange", syncOnFocus);
      window.removeEventListener("winter-arc-progress", syncOnFocus);
    };
  }, [dataMode]);

  if (dataMode === "loading" || (dataMode !== "cloud-read-only" && !localData)) {
    return (
      <main className="today-page today-account-loading">
        <AppHeader />
        <p role="status">{dataMode === "loading" ? "Preparing your Winter Arc…" : "Opening today's rituals…"}</p>
      </main>
    );
  }

  const entries = cloudModel?.entries || localData.entries;
  const rituals = cloudModel?.rituals || localData.rituals;
  const visibleRituals = rituals.filter((ritual) => ritual.id !== "sleep-tracker");
  const dayNumberValue = cloudModel?.dayNumber ?? localData.dayNumber;
  const arcActive = cloudModel?.arcActive ?? localData.arcActive;
  const cloudReadOnly = dataMode === "cloud-read-only";

  const completedCount = rituals.filter(
    (ritual) => !isInformationalRitual(ritual) && getRitualStatus(ritual, entries[ritual.id]).completed
  ).length;
  const completionRituals = rituals.filter((ritual) => !isInformationalRitual(ritual));
  const progress = completionRituals.length
    ? (completedCount / completionRituals.length) * 100
    : 0;
  const dayNumber = String(dayNumberValue).padStart(2, "0");
  const timePeriod = getTimePeriod(now);
  const timeCopy = TIME_COPY[timePeriod];

  const prepareCloudHabitRequest = (input) => {
    const habitId = globalThis.crypto?.randomUUID?.();
    const cloudHabitId = globalThis.crypto?.randomUUID?.();
    const definitionId = globalThis.crypto?.randomUUID?.();
    if (!habitId || !cloudHabitId || !definitionId || !account.userId || !account.programId) return null;
    const createdAt = new Date().toISOString();
    const habit = createCustomHabitRecord({
      id: `custom-${habitId}`,
      title: input.title,
      type: input.type,
      unit: input.unit,
      goal: input.goal,
      createdAt,
      archived: false,
      order: account.progress.customHabits?.length || 0,
    });
    if (!habit) return null;

    const dateISO = toISODate();
    const todaySnapshot = account.progress.ritualSnapshots?.[dateISO];
    return {
      expectedUserId: account.userId,
      expectedProgramId: account.programId,
      habit: { ...habit, cloudId: cloudHabitId },
      definitionId,
      dateISO,
      ritualSnapshot: todaySnapshot?.length ? todaySnapshot : cloudModel.rituals,
    };
  };

  const createCloudHabit = async (request) => {
    const result = await saveCustomHabitToCloud(request);
    if (result.error) {
      if (result.error.code === "AUTHENTICATION_CHANGED" || result.error.code === "PROGRAM_CHANGED") {
        account.retry(request.expectedUserId);
      } else if (result.error.code === "CONFLICT") {
        await account.refresh(request.expectedUserId);
      }
      return result;
    }

    const applied = account.applyCustomHabit({
      userId: request.expectedUserId,
      programId: request.expectedProgramId,
      dateISO: result.data.dateISO,
      habit: result.data.habit,
      ritualSnapshot: result.data.ritualSnapshot,
    });
    if (!applied) {
      account.retry(request.expectedUserId);
      return repositoryResult(null, {
        code: "AUTHENTICATION_CHANGED",
        message: "Your account changed while saving. Reload your account data and try again.",
      });
    }
    setPendingCloudHabitRequest(null);
    return result;
  };

  const handleArchiveCustomHabit = async (ritual) => {
    if (archivingHabitId) return;
    setArchivingHabitId(ritual.id);
    setCustomHabitError("");
    if (cloudReadOnly) {
      const habit = account.progress.customHabits?.find((item) => item.id === ritual.id && !item.archived);
      const result = habit ? await archiveCustomHabitToCloud({
        expectedUserId: account.userId,
        expectedProgramId: account.programId,
        habit,
      }) : { error: { code: "CUSTOM_HABIT_NOT_FOUND", message: "Refresh your account data and try again." } };
      if (result.error) {
        if (result.error.code === "CONFLICT" || result.error.code === "AUTHENTICATION_CHANGED" || result.error.code === "PROGRAM_CHANGED") {
          await account.refresh(account.userId);
        }
        setCustomHabitError(result.error.message || "This habit could not be archived. Please try again.");
      } else {
        await account.refresh(account.userId);
      }
    } else {
      const archived = archiveCustomHabit(ritual.id);
      if (archived) {
        setLocalData({
          entries: getTodayEntries(),
          rituals: getAllRituals(),
          dayNumber: getDayNumber(now),
          arcActive: isDateWithinArc(loadProgress(), toISODate(now)),
        });
      } else {
        setCustomHabitError("This habit could not be archived. Refresh and try again.");
      }
    }
    setArchivingHabitId(null);
  };

  const handleUpdateCustomHabit = async (nextHabit) => {
    if (cloudReadOnly) {
      const definitionId = globalThis.crypto?.randomUUID?.();
      if (!definitionId) return { error: { message: "This browser could not create a safe habit revision. Please try again." } };
      const result = await updateCustomHabitInCloud({
        expectedUserId: account.userId,
        expectedProgramId: account.programId,
        habit: editingHabit,
        definitionId,
        changes: nextHabit,
      });
      if (result.error) {
        if (result.error.code === "CONFLICT" || result.error.code === "AUTHENTICATION_CHANGED" || result.error.code === "PROGRAM_CHANGED") {
          await account.refresh(account.userId);
        }
        return result;
      }
      const applied = account.applyCustomHabit({
        userId: account.userId,
        programId: account.programId,
        dateISO: toISODate(),
        habit: result.data,
      });
      if (!applied) {
        await account.retry(account.userId);
        return { error: { message: "Your account changed while saving. Reload your data and try again." } };
      }
      return result;
    }

    const updated = updateCustomHabitDefinition(nextHabit.id, nextHabit);
    if (!updated) return { error: { message: "This habit could not be updated. Check its name and target." } };
    setLocalData({
      entries: getTodayEntries(),
      rituals: getAllRituals(),
      dayNumber: getDayNumber(now),
      arcActive: isDateWithinArc(loadProgress(), toISODate(now)),
    });
    return { data: updated, error: null };
  };

  return (
    <main className="today-page" data-time-period={timePeriod}>
      <AppHeader tone={timePeriod === "night" ? "dark" : "light"} />

      {dataMode === "local-no-cloud-program" ? (
        <div className="today-data-notice" role="status">
          This account has no cloud program yet. Today is showing this browser's local progress.
        </div>
      ) : null}
      {dataMode === "local-cloud-error" ? (
        <div className="today-data-notice today-data-notice--error" role="alert">
          <span>
            {account.error?.message || "Cloud progress could not be loaded."} Today is showing this browser's local progress instead.
          </span>
          <button type="button" onClick={account.retry}>Retry cloud loading</button>
        </div>
      ) : null}
      {cloudReadOnly ? (
        <div className="today-data-notice" role="status">
          Showing your cloud progress for this account.
        </div>
      ) : null}

      <header className="today-header">
        <div className="today-glow" aria-hidden="true" />
        <div className="today-sparkles" aria-hidden="true">
          <span>✦</span>
          <span>✧</span>
          <span>·</span>
          <span>✦</span>
          <span>✧</span>
        </div>

        <p className="today-date">
          {formatTodayLabel(now)}
        </p>

        <div className="today-meta">
          <span>DAY {dayNumber} / {ARC_DURATION_DAYS}</span>
          <span>{formatTime(now)}</span>
        </div>

        <h1>
          {personalizeGreetingHeading(timeCopy.heading, displayName)}
          <em>{timeCopy.supporting}</em>
        </h1>

        <p className="today-message">
          {timeCopy.message}
        </p>
      </header>

      <section className="today-progress">
        {!arcActive ? <p className="today-arc-ended" role="status">Your {ARC_DURATION_DAYS}-day Winter Arc is complete. Your saved progress remains available in Journey and History.</p> : null}
        <div className="progress-top">
          <span>TODAY'S JOURNEY</span>
          <strong>
            {completedCount} / {completionRituals.length}
            <em> completed</em>
          </strong>
        </div>

        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>

        <p>{getProgressMessage(completedCount, completionRituals.length, timePeriod)}</p>
      </section>

      <section className="ritual-checklist">
        <div className="ritual-heading">
          <p>TODAY'S RITUALS</p>
          <span>{cloudReadOnly ? "Open a ritual to update today's progress." : "Open a ritual to begin."}</span>
        </div>
        {customHabitError ? <p className="custom-habit-action-error" role="alert">{customHabitError}</p> : null}

        <div className="ritual-items">
          {visibleRituals.map((ritual) => {
            const status = getRitualStatus(ritual, entries[ritual.id]);
            const mark = todayMark(status);

            const className = `ritual-item ${status.completed ? "completed" : ""} ${status.inProgress ? "in-progress" : ""} ${status.rangeState === "above" ? "is-above" : ""}`;
            const itemContent = (
              <>
                <div className="ritual-icon">
                  {status.completed ? "✓" : ritual.icon}
                </div>

                <div className="ritual-info">
                  <h3>{ritual.title}</h3>
                  <p>{todayDetail(ritual, status)}</p>
                </div>

                <div
                  className={`ritual-check ${status.inProgress ? "is-progress" : ""} ${status.completed ? "is-complete" : ""} ${status.rangeState === "above" ? "is-above" : ""}`}
                >
                  {mark}
                </div>
              </>
            );

            const card = arcActive ? (
              <Link key={ritual.id} to={ritual.route} className={className}>
                {itemContent}
              </Link>
            ) : (
              <div key={ritual.id} className={`${className} is-arc-ended`} aria-disabled="true">
                {itemContent}
              </div>
            );
            if (ritual.source === "custom") {
              return (
                <div className="custom-habit-row" key={ritual.id}>
                  {card}
                  <div className="custom-habit-actions">
                    <button
                      className="custom-habit-edit"
                      type="button"
                      aria-label={`Edit ${ritual.title}`}
                      disabled={Boolean(archivingHabitId)}
                      onClick={() => setEditingHabit(account.progress?.customHabits?.find((habit) => habit.id === ritual.id) || loadProgress().customHabits.find((habit) => habit.id === ritual.id))}
                    >
                      Edit
                    </button>
                    <button
                      className="custom-habit-archive"
                      type="button"
                      aria-label={`Archive ${ritual.title}`}
                      disabled={Boolean(archivingHabitId)}
                      onClick={() => handleArchiveCustomHabit(ritual)}
                    >
                      {archivingHabitId === ritual.id ? "Archiving…" : "Archive"}
                    </button>
                  </div>
                </div>
              );
            }
            return card;
          })}
        </div>

        <button
          type="button"
          className="add-habit-button"
          disabled={!arcActive}
          onClick={() => setAddingHabit(true)}
        >
          + Add Custom Habit
        </button>
      </section>

      <AddHabitModal
        key={`${addingHabit ? "add" : "view"}:${editingHabit?.id || "none"}`}
        open={addingHabit || Boolean(editingHabit)}
        onClose={() => { setAddingHabit(false); setEditingHabit(null); }}
        editingHabit={editingHabit}
        onUpdate={handleUpdateCustomHabit}
        cloudMode={cloudReadOnly}
        onPrepareCloudRequest={prepareCloudHabitRequest}
        onCreateCloud={createCloudHabit}
        pendingCloudRequest={pendingCloudHabitRequest}
        onPendingCloudRequestChange={setPendingCloudHabitRequest}
        canRetryCloudRequest={!pendingCloudHabitRequest || (
          cloudReadOnly
          && account.userId === pendingCloudHabitRequest.expectedUserId
          && account.programId === pendingCloudHabitRequest.expectedProgramId
        )}
        onCreated={() => {
          if (!cloudReadOnly) {
            setLocalData({ entries: getTodayEntries(), rituals: getAllRituals(), dayNumber: getDayNumber(now) });
          }
        }}
      />

      <footer className="today-footer">
        <span>✦</span>
        <p>Small steps become a life.</p>
        <span>✦</span>
      </footer>
    </main>
  );
}

export default TodayDashboard;
