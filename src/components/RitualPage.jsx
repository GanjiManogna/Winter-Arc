import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import AppHeader from "./AppHeader";
import {
  getRitualProgressPercent,
  getRitualStatus,
  canCompleteSkincareAt,
  canCompleteSleepOnTimeAt,
  getHealthyMealsCount,
  getHealthyMealsMask,
  getSunscreenApplicationCount,
  isInformationalRitual,
  isMeasurableRitual,
  isRangeRitual,
  toNumericValue,
} from "../data/ritualStatus";
import {
  ARC_DURATION_DAYS,
  getEntry,
  getRitualById,
  getRitualHistory,
  getRitualStats,
  getRitualByIdFromProgress,
  getRitualHistoryFromProgress,
  getRitualStatsFromProgress,
  isDateWithinArc,
  loadProgress,
  mergeRitualEntry,
  toISODate,
  upsertRitualEntry,
  getSleepSummaryFromProgress,
  withCalculatedSleepDuration,
} from "../data/storage";
import { formatSleepDuration, isLocalTime } from "../data/sleepDuration.js";
import { getAccountDataMode } from "../data/accountDataMode.js";
import { useAccountDataLifecycle } from "../data/useAccountDataLifecycle.js";
import { saveDailyRitualEntry } from "../data/dailyRitualWriteService.js";
import { getNextSunscreenApplicationTime } from "../data/sunscreenGuidance.js";
import AccountDataNotice, { AccountDataLoading } from "./AccountDataNotice.jsx";
import "./RitualPage.css";

function formatHistoryDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
  });
}

function formatValue(ritual, value) {
  if (!isMeasurableRitual(ritual)) {
    return "—";
  }
  const numeric = toNumericValue(value);
  if (numeric <= 0) {
    return "—";
  }
  if (isRangeRitual(ritual)) {
    return numeric.toLocaleString(undefined, {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    });
  }
  return numeric.toLocaleString();
}

function formatLocalTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function localTimeValue(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatSleepClockTime(value) {
  if (!isLocalTime(value)) return "";
  const [hours, minutes] = value.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function rangeNote(status) {
  if (status.rangeState === "below") {
    return "A little below the restful range. Be gentle with yourself.";
  }
  if (status.rangeState === "within") {
    return "Within the restful range.";
  }
  if (status.rangeState === "above") {
    return "Longer than the usual range. Rest is still rest.";
  }
  return "A quiet night begins when you record it.";
}

function RitualMotif({ theme, progressPercent = 0, completed = false, active = false }) {
  const common = {
    className: `ritual-motif motif-${theme}`,
    viewBox: "0 0 240 200",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    focusable: "false",
  };

  switch (theme) {
    case "sunscreen":
      return (
        <svg {...common}>
          <g className={`sunscreen-motif-settle ${completed ? "is-applied" : ""}`}>
            <g className="sunscreen-sun">
              <circle cx="183" cy="61" r="15" fill="currentColor" fillOpacity=".1" />
              <circle cx="183" cy="61" r="15" />
              <path d="M183 37v-7m0 62v-7m24-24h7m-62 0h7m41-17 5-5m-44 44 5-5m34 0 5 5m-44-44 5 5" />
            </g>
            <path d="M86 51h48v17H86zM93 68v15L78 99v57a12 12 0 0 0 12 12h40a12 12 0 0 0 12-12V99l-15-16V68" />
            <path d="M78 101h64" />
            <rect x="88" y="109" width="44" height="34" rx="5" fill="currentColor" fillOpacity=".08" />
            <text className="sunscreen-spf-label" x="110" y="131" textAnchor="middle">SPF</text>
            <path d="m177 92 23 8v20c0 18-11 31-23 39-12-8-23-21-23-39v-20l23-8Z" />
            <path d="m166 120 8 8 15-17" />
          </g>
        </svg>
      );
    case "skincare":
      return (
        <svg {...common}>
          <g className={`skincare-motif-settle ${completed ? "is-complete" : ""}`}>
            <path d="M65 81h48v73a12 12 0 0 1-12 12H77a12 12 0 0 1-12-12V81Z" />
            <path d="M72 81V68h25v13m0-8h14v6H97m-20-10h15" />
            <path d="M65 96h48" />
            <rect x="72" y="108" width="34" height="27" rx="4" fill="currentColor" fillOpacity=".08" />
            <text className="skincare-motif-label" x="89" y="125" textAnchor="middle">MOIST</text>
            <path d="M166 52c-20 0-32 15-32 37v29c0 22 13 37 32 37s32-15 32-37V89c0-22-12-37-32-37Z" />
            <path d="M144 85c6-9 14-13 22-13s16 4 22 13m-33 18h1m20 0h1m-11 1v13l-6 3m1 12c5 4 11 4 16 0" />
            <path d="M126 94c-6 8-6 13 0 17 6-4 6-9 0-17Zm73 9c-5 7-5 11 0 14 5-3 5-7 0-14Z" />
            <path d="M50 119c-5 7-5 11 0 14 5-3 5-7 0-14Z" />
          </g>
        </svg>
      );
    case "sunrise":
      return <svg {...common}><circle cx="120" cy="104" r="34" fill="currentColor" opacity=".12" stroke="none" /><path d="M38 139h164M57 122h126M75 104h18m54 0h18M86 70l-9-9m77 9 9-9M120 54V39" /></svg>;
    case "water":
      return <svg {...common}><path d="M87 52h66v99a13 13 0 0 1-13 13h-40a13 13 0 0 1-13-13V52Z" /><path d="M101 52V39h38v13m-51 65c18-9 46 9 64 0m-64 13c18-9 46 9 64 0" /><path d="M49 80c-10 13-10 22 0 27 10-5 10-14 0-27Zm141 34c-8 11-8 18 0 23 8-5 8-12 0-23Z" /></svg>;
    case "nature":
      return (
        <svg {...common}>
          <defs>
            <g id="winter-arc-footprint">
              <path d="M12 37c-10-2-14-11-11-21C4 5 11-2 17 1c7 3 8 17 6 27-1 7-5 11-11 9Z" fill="currentColor" fillOpacity=".09" />
              <circle cx="5" cy="10" r="3.3" />
              <circle cx="11" cy="4" r="3.2" />
              <circle cx="18" cy="5" r="2.8" />
              <circle cx="24" cy="10" r="2.3" />
            </g>
            <g id="winter-arc-footprint-trail">
              <path d="M35 163c52-14 111-62 168-126" strokeDasharray="2 9" />
              <use href="#winter-arc-footprint" x="37" y="132" />
              <use href="#winter-arc-footprint" x="81" y="100" />
              <use href="#winter-arc-footprint" x="127" y="67" />
              <use href="#winter-arc-footprint" x="173" y="34" />
            </g>
            <clipPath id="winter-arc-steps-progress" clipPathUnits="userSpaceOnUse">
              <rect
                className="steps-progress-clip"
                x="0"
                y="0"
                width="0%"
                height="200"
                style={{ width: `${progressPercent}%` }}
              />
            </clipPath>
          </defs>
          <use href="#winter-arc-footprint-trail" className="steps-trail-base" />
          <use
            href="#winter-arc-footprint-trail"
            className="steps-trail-active"
            clipPath="url(#winter-arc-steps-progress)"
          />
          {completed ? <path className="steps-complete-mark" d="m208 91 7 7 15-17" /> : null}
        </svg>
      );
    case "strength":
      return <svg {...common}><path d="M58 83v34m17-47v60m90-47v34m-17-47v60M75 100h90" /><path d="M54 148c28-14 43-32 58-57m17 57c19-12 34-29 47-52" strokeDasharray="3 8" /></svg>;
    case "earth":
      return <svg {...common}><g className={`meal-motif-settle ${completed ? "is-settled" : ""}`}><circle cx="120" cy="104" r="66" /><circle cx="120" cy="104" r="55" /><path d="M120 49v110M65 104h110" /><path d="M80 81c8-11 18-17 30-19m49 25c-7-11-17-18-29-21M79 126c8 12 18 18 31 20m49-24c-7 12-17 18-29 21" /><circle cx="94" cy="88" r="5" fill="currentColor" fillOpacity=".16" /><circle cx="146" cy="86" r="4" fill="currentColor" fillOpacity=".16" /><path d="M91 130c7-6 15-7 23-2-4 9-12 12-23 2Zm38-42c7-6 14-6 22-1-4 9-12 11-22 1Z" fill="currentColor" fillOpacity=".12" /></g></svg>;
    case "wellness":
      return <svg {...common}><g className={`clean-choice-motif-settle ${completed ? "is-settled" : ""}`}><path d="m42 72 8-10h43l8 10-5 78-7 8H54l-8-8-4-78Z" /><path d="M50 62v10h43V62m-39 29h34m-33 9h32" /><circle cx="64" cy="118" r="4" /><circle cx="78" cy="122" r="4" /><circle cx="69" cy="135" r="4" /><path d="M111 111h24m-8-8 8 8-8 8" /><path d="M173 91c-10-12-31-6-34 11-4 23 16 40 25 46 9-6 29-23 25-46-3-17-24-23-34-11Z" /><path d="M172 91c-1-12 5-20 17-25 2 12-4 21-17 25Zm0 0c-9-7-18-7-27-1 8 8 17 8 27 1Z" /></g></svg>;
    case "knowledge":
      return <svg {...common}><g className={`learning-motif ${active ? "is-active" : ""} ${completed ? "is-complete" : ""}`}><path d="M120 70c-25-19-52-21-81-13v84c29-8 56-6 81 13 25-19 52-21 81-13V57c-29-8-56-6-81 13Z" /><path d="M120 70v84M53 78c17-3 33-1 48 5m-48 12c17-3 33-1 48 5m54-22c14-6 27-8 40-5m-40 22c14-6 27-8 40-5" /><path d="M109 46h22m-11-11v22" /></g></svg>;
    case "stillness":
      return <svg {...common}><circle cx="120" cy="101" r="68" strokeDasharray="2 8" /><circle cx="120" cy="101" r="48" strokeDasharray="1 7" /><circle cx="120" cy="74" r="12" /><path d="M120 88c-17 0-30 17-33 36l-4 20m37-56c17 0 30 17 33 36l4 20m-68 0c12-12 23-17 35-17s23 5 35 17m-70 0h70" /></svg>;
    case "moonlight":
      return (
        <svg {...common}>
          <g className={`sleep-motif-settle ${completed ? "is-settled" : ""}`}>
            <path d="M142 48a55 55 0 1 0 49 84 51 51 0 0 1-49-84Z" fill="currentColor" opacity=".12" />
            <path d="M142 48a55 55 0 1 0 49 84 51 51 0 0 1-49-84Z" />
            <path d="M62 58v10m-5-5h10m93 70v8m-4-4h8M77 112v6m-3-3h6m76-72v6m-3-3h6" />
            <path d="M43 158c37-12 117-12 154 0" strokeDasharray="2 7" />
          </g>
        </svg>
      );
    case "rest":
      return <svg {...common}><circle cx="120" cy="104" r="61" strokeDasharray="2 7" /><path d="M120 104V69m0 35 25 15" /><path d="M120 49a55 55 0 1 0 49 84 51 51 0 0 1-49-84Z" /><path d="M63 47v8m-4-4h8m114 27v8m-4-4h8" /></svg>;
    default:
      return null;
  }
}

function RitualPage() {
  const { ritualId } = useParams();
  const resolvedRitualId = ritualId === "read" ? "learn" : ritualId;
  const account = useAccountDataLifecycle();
  const mode = getAccountDataMode(account.status);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer;
    const refresh = () => setNow(new Date());
    const schedule = () => {
      const current = new Date();
      const delay = 60000 - current.getSeconds() * 1000 - current.getMilliseconds();
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, delay);
    };
    const onVisibilityChange = () => { if (!document.hidden) refresh(); };
    schedule();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  if (mode === "loading") {
    return (
      <main className="ritual-page">
        <AppHeader />
        <AccountDataLoading />
      </main>
    );
  }

  const progress = mode === "cloud-read-only" ? account.progress : loadProgress();
  const dateISO = toISODate(now);
  const sourceEntry = isDateWithinArc(progress, dateISO)
    ? mode === "cloud-read-only"
      ? (resolvedRitualId === "sleep-tracker"
        ? withCalculatedSleepDuration(progress, dateISO)[resolvedRitualId]
        : progress.entries?.[dateISO]?.[resolvedRitualId]) || null
      : (resolvedRitualId === "sleep-tracker"
        ? withCalculatedSleepDuration(progress, dateISO)[resolvedRitualId]
        : getEntry(resolvedRitualId, dateISO)) || null
    : null;
  return (
    <RitualView
      key={`${account.identityKey}:${resolvedRitualId}:${dateISO}:${JSON.stringify(sourceEntry)}`}
      ritualId={resolvedRitualId}
      account={account}
      mode={mode}
      progress={progress}
      now={now}
    />
  );
}

function RitualView({ ritualId, account, mode, progress, now }) {
  const location = useLocation();
  const cloudMode = mode === "cloud-read-only";
  const ritual = cloudMode ? getRitualByIdFromProgress(ritualId, progress) : getRitualById(ritualId);
  const currentDateISO = toISODate(now);
  const arcActive = isDateWithinArc(progress, currentDateISO);
  const [entry, setEntry] = useState(() => cloudMode
    ? (arcActive ? progress.entries?.[currentDateISO]?.[ritualId] : null) || null
    : getEntry(ritualId));
  const [draftValue, setDraftValue] = useState(() => {
    const current = cloudMode
      ? progress.entries?.[currentDateISO]?.[ritualId]?.value
      : getEntry(ritualId)?.value;
    return current === null || current === undefined ? "" : current;
  });
  const [selectedLocalTime, setSelectedLocalTime] = useState(() =>
    (ritual.id === "sleep" ? entry?.sleepTime : ritual.id === "wake" ? entry?.wakeTime : null) || localTimeValue(now)
  );
  const [justCompleted, setJustCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [failedPatch, setFailedPatch] = useState(null);
  const confirmedEntry = useRef(entry);

  useEffect(() => {
    if (ritual?.title) {
      document.title = `${ritual.title} · Winter Arc`;
    }
    return () => {
      document.title = "winter-arc";
    };
  }, [ritual]);

  if (!ritual) {
    return <Navigate to="/today" replace />;
  }

  const measurable = isMeasurableRitual(ritual);
  const ranged = isRangeRitual(ritual);
  const history = cloudMode
    ? getRitualHistoryFromProgress(progress, ritual.id, 4)
    : getRitualHistory(ritual.id, 4);
  const stats = cloudMode
    ? getRitualStatsFromProgress(progress, ritual.id)
    : getRitualStats(ritual.id);
  const progressValue = toNumericValue(draftValue);
  const status = getRitualStatus(ritual, measurable
    ? { value: draftValue }
    : entry);
  const isComplete = status.completed;
  const progressPercent = measurable
    ? getRitualProgressPercent(ritual, draftValue)
    : isComplete
      ? 100
      : 0;
  const isWaterRitual = ritual.id === "water";
  const isStepsRitual = ritual.id === "steps";
  const isWorkoutRitual = ritual.id === "workout";
  const isMeditationRitual = ritual.id === "meditate";
  const isCustomMeasurable = ritual.source === "custom" && measurable;
  const isSleepOnTimeRitual = ritual.id === "sleep";
  const isSleepTrackerRitual = ritual.id === "sleep-tracker";
  const sleepSummary = isSleepTrackerRitual
    ? getSleepSummaryFromProgress(progress, currentDateISO)
    : null;
  const tonightBedtimeRecorded = Boolean(
    progress.entries?.[currentDateISO]?.sleep?.completed
      && isLocalTime(progress.entries[currentDateISO].sleep.sleepTime)
  );
  const isSunscreenRitual = ritual.id === "sunscreen";
  const isSkincareRitual = ritual.id === "skincare";
  const isFoodRitual = ritual.id === "food";
  const isNoJunkFoodRitual = ritual.id === "no-junk-food";
  const isLearnRitual = ritual.id === "learn";
  const skincareLocked = isSkincareRitual && !canCompleteSkincareAt(now);
  const sleepCompletionLocked = isSleepOnTimeRitual && !isComplete && !canCompleteSleepOnTimeAt(now);
  const applicationCount = getSunscreenApplicationCount(entry);
  const healthyMealsMask = getHealthyMealsMask(entry);
  const healthyMealsCount = getHealthyMealsCount(entry);
  const waterValue = Math.max(0, progressValue);
  const waterFilledCount = Math.min(ritual.goal || 8, Math.floor(waterValue));
  const waterNextIndex = isWaterRitual && waterValue < (ritual.goal || 8)
    ? Math.min(Math.floor(waterValue), (ritual.goal || 8) - 1)
    : -1;
  const waterLastFilledIndex = waterFilledCount - 1;
  const sleepScalePercent = Math.max(0, Math.min(100, ((progressValue - 6) / 3) * 100));
  const applicationTimes = Array.isArray(entry?.applicationTimes) ? entry.applicationTimes : [];
  const validApplicationTimes = applicationTimes.filter(
    (timestamp) => typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))
  );
  const lastApplicationTime = [...applicationTimes].reverse().find(
    (timestamp) => typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))
  ) || null;
  const nextApplicationTime = lastApplicationTime
    ? getNextSunscreenApplicationTime(lastApplicationTime, now)
    : null;

  const darkThemes = new Set(["strength", "moonlight"]);
  const headerTone = darkThemes.has(ritual.theme) || isSleepTrackerRitual ? "dark" : "light";

  const persistMeasurable = (raw) => {
    if (!arcActive) return null;
    const parsed = raw === "" ? null : Number(raw);
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    if (!cloudMode) {
      const next = upsertRitualEntry(ritual.id, { value });
      setEntry(next);
      confirmedEntry.current = next;
      return next;
    }
    return persistCloudPatch({ value });
  };

  const persistCloudPatch = async (patch) => {
    if (saving || !arcActive) return null;
    const dateISO = currentDateISO;
    const previous = confirmedEntry.current;
    const next = mergeRitualEntry(ritual, previous, patch);
    if (ritual.source === "custom") next.customHabitId = ritual.id;
    setSaving(true);
    setSaveError("");
    setSaveMessage("Saving to your account…");
    setEntry(next);
    if (isMeasurableRitual(ritual)) {
      setDraftValue(next.value === null || next.value === undefined ? "" : String(next.value));
    }

    const result = await saveDailyRitualEntry({
      expectedUserId: account.userId,
      expectedProgramId: account.programId,
      dateISO,
      ritualId: ritual.id,
      entry: next,
      arcStartDate: progress.startDate,
    });
    setSaving(false);

    if (result.error) {
      confirmedEntry.current = previous;
      setEntry(previous);
      if (isMeasurableRitual(ritual)) {
        setDraftValue(previous?.value === null || previous?.value === undefined ? "" : String(previous.value));
      }
      setFailedPatch(patch);
      setSaveError(result.error.message);
      setSaveMessage("");
      if (result.error.code === "AUTHENTICATION_CHANGED" || result.error.code === "PROGRAM_CHANGED") {
        account.retry(account.userId);
      } else if (result.error.code === "CONFLICT") {
        const refreshed = await account.refresh(account.userId);
        const latest = refreshed?.progress?.entries?.[dateISO]?.[ritual.id] || null;
        confirmedEntry.current = latest;
        setEntry(latest);
        setFailedPatch(null);
        setSaveError("Newer cloud progress was found. The latest value is shown; make another change if you want to update it.");
        if (isMeasurableRitual(ritual)) {
          setDraftValue(latest?.value === null || latest?.value === undefined ? "" : String(latest.value));
        }
      }
      return null;
    }

    confirmedEntry.current = result.data;
    setEntry(result.data);
    setFailedPatch(null);
    setSaveError("");
    setSaveMessage("Saved to your account.");
    const currentIdentity = account.applyDailyEntry({
      userId: account.userId,
      programId: account.programId,
      dateISO,
      ritualId: ritual.id,
      entry: result.data,
    });
    if (!currentIdentity) {
      return null;
    }
    return result.data;
  };

  const handleValueChange = (event) => {
    if (!arcActive) return;
    const next = event.target.value;
    setDraftValue(next);
    if (!cloudMode) {
      const saved = persistMeasurable(next);
      if (saved.completed) setJustCompleted(true);
    }
  };

  const handleWaterGlassStep = (direction) => {
    const next = direction > 0
      ? Math.min(ritual.goal, waterValue + 1)
      : Math.max(0, waterValue - 1);
    setDraftValue(String(next));
    if (cloudMode) {
      persistMeasurable(next).then((saved) => { if (saved?.completed) setJustCompleted(true); });
    } else {
      const saved = persistMeasurable(next);
      if (saved.completed) setJustCompleted(true);
    }
  };

  const handleMeasuredStep = (direction) => {
    const next = Math.max(0, progressValue + direction);
    setDraftValue(String(next));
    if (cloudMode) {
      persistMeasurable(next).then((saved) => { if (saved?.completed) setJustCompleted(true); });
    } else {
      const saved = persistMeasurable(next);
      if (saved.completed) setJustCompleted(true);
    }
  };

  const handleAction = async () => {
    if (!arcActive || skincareLocked || sleepCompletionLocked) return;
    if (measurable) {
      const saved = cloudMode
        ? await persistMeasurable(draftValue)
        : persistMeasurable(draftValue);
      setJustCompleted(Boolean(saved?.completed));
      return;
    }

    if (isSunscreenRitual) {
      const appliedAt = new Date().toISOString();
      const nextApplicationTimes = [...applicationTimes, appliedAt];
      const completesSunscreen = getSunscreenApplicationCount({ applicationTimes: nextApplicationTimes }) >= 2;
      const patch = {
        completed: completesSunscreen,
        completedAt: completesSunscreen ? entry?.completedAt || appliedAt : null,
        applicationTimes: nextApplicationTimes,
      };
      if (cloudMode) {
        const saved = await persistCloudPatch(patch);
        setJustCompleted(Boolean(saved?.completed));
      } else {
        const next = upsertRitualEntry(ritual.id, patch);
        if (!next) return;
        setEntry(next);
        confirmedEntry.current = next;
        setJustCompleted(Boolean(next.completed));
      }
      return;
    }

    if (isFoodRitual) return;

    const patch = {
      completed: !isComplete,
      completedAt: !isComplete ? new Date().toISOString() : null,
      ...(ritual.id === "sleep" ? { sleepTime: !isComplete ? selectedLocalTime : null } : {}),
      ...(ritual.id === "wake" ? { wakeTime: !isComplete ? selectedLocalTime : null } : {}),
    };
    const selectedSleepTimeIsBeforeCutoff = ritual.id !== "sleep"
      || (isLocalTime(selectedLocalTime) && selectedLocalTime < "23:00");
    if (!isComplete && (ritual.id === "sleep" || ritual.id === "wake")
      && (!isLocalTime(selectedLocalTime) || !selectedSleepTimeIsBeforeCutoff)) {
      setSaveError("Choose a valid local time before saving.");
      return;
    }
    if (cloudMode) {
      const saved = await persistCloudPatch(patch);
      setJustCompleted(Boolean(saved?.completed));
    } else {
      const next = upsertRitualEntry(ritual.id, patch, currentDateISO);
      setEntry(next);
      confirmedEntry.current = next;
      setJustCompleted(!isComplete);
    }
  };

  const handleMealToggle = async (mealIndex) => {
    if (!arcActive || saving) return;
    const nextMask = healthyMealsMask ^ (1 << mealIndex);
    const nextCount = Number(Boolean(nextMask & 1))
      + Number(Boolean(nextMask & 2))
      + Number(Boolean(nextMask & 4));
    const completed = nextCount >= 2;
    const patch = {
      value: nextMask,
      completed,
      completedAt: completed ? entry?.completedAt || new Date().toISOString() : null,
    };
    if (cloudMode) {
      const saved = await persistCloudPatch(patch);
      setJustCompleted(Boolean(saved?.completed));
      return;
    }
    const next = upsertRitualEntry(ritual.id, patch);
    if (!next) return;
    setEntry(next);
    confirmedEntry.current = next;
    setJustCompleted(Boolean(next.completed));
  };

  const buttonLabel = isSunscreenRitual
    ? isComplete ? "Re-apply Sunscreen" : "Apply Sunscreen"
    : isInformationalRitual(ritual)
    ? progressValue > 0
      ? "Sleep Recorded ✦"
      : "Save Sleep Record"
    : measurable
    ? ranged
      ? status.rangeState === "within"
        ? "Completed ✦"
        : status.rangeState === "above"
          ? "Saved ✦"
          : "Save Progress"
      : isComplete
        ? "Completed ✦"
        : "Save Progress"
    : isComplete
      ? "Completed ✦"
      : "Mark as Complete";

  return (
    <main
      className={`ritual-page theme-${ritual.theme} ${isSleepTrackerRitual ? "sleep-tracker-page" : ""}`}
      data-ritual-theme={ritual.theme}
    >
      <div className="ritual-atmosphere" aria-hidden="true">
        <div className="ritual-glow" />
        <div className="ritual-particles">
          <span /><span /><span /><span /><span /><span />
        </div>
      </div>

      <AppHeader tone={headerTone} />

      <AccountDataNotice mode={mode} surface="ritual" />
      <div className="ritual-layout">
        <Link className="ritual-back" to={location.state?.returnTo || "/today"}>
          ← Today
        </Link>

        <section className="ritual-hero">
          <RitualMotif
            theme={ritual.theme}
            progressPercent={(isStepsRitual || isLearnRitual) ? progressPercent : 0}
            completed={(isStepsRitual || isSleepOnTimeRitual || isFoodRitual || isNoJunkFoodRitual || isLearnRitual || isSunscreenRitual) && isComplete}
            active={isLearnRitual && progressValue > 0}
          />
          <div className="ritual-hero-copy">
            <h1>{ritual.title}</h1>

            <p className="ritual-line">{ritual.inspirationalLine}</p>
          </div>
        </section>

        <section className="ritual-card">
          <p className="ritual-section-label">{ritual.actionLabel}</p>

          {isSleepTrackerRitual ? (
            <div className="sleep-tracker-daily" aria-label="Daily sleep information">
              <div className="sleep-tracker-timeline">
                <div className="sleep-tracker-timepoint">
                  <span className="sleep-tracker-timepoint__symbol" aria-hidden="true">☾</span>
                  <div>
                    <span className="sleep-tracker-timepoint__label">Bedtime</span>
                    <strong>{sleepSummary.sleepTime ? formatSleepClockTime(sleepSummary.sleepTime) : "Not recorded"}</strong>
                  </div>
                </div>
                <div className="sleep-tracker-duration" role="status" aria-live="polite">
                  <span className="sleep-tracker-duration__line" aria-hidden="true" />
                  <span className="sleep-tracker-duration__label">Sleep duration</span>
                  <strong>{sleepSummary.durationMinutes !== null ? formatSleepDuration(sleepSummary.durationMinutes) : "—"}</strong>
                  {sleepSummary.durationMinutes === null ? (
                    <span className="sleep-tracker-duration__note">
                      {sleepSummary.sleepTime && sleepSummary.wakeTime
                        ? "These times are outside the supported duration range."
                        : sleepSummary.sleepTime || sleepSummary.wakeTime
                          ? "Add the other time to calculate your rest."
                          : "Your recorded rest will appear here."}
                    </span>
                  ) : null}
                  <span className="sleep-tracker-duration__line" aria-hidden="true" />
                </div>
                <div className="sleep-tracker-timepoint">
                  <span className="sleep-tracker-timepoint__symbol sleep-tracker-timepoint__symbol--wake" aria-hidden="true">☀</span>
                  <div>
                    <span className="sleep-tracker-timepoint__label">Wake-up</span>
                    <strong>{sleepSummary.wakeTime ? formatSleepClockTime(sleepSummary.wakeTime) : "Not recorded"}</strong>
                  </div>
                </div>
              </div>
              {sleepSummary.durationMinutes === null && sleepSummary.manualHours !== null ? (
                <p className="sleep-tracker-legacy" role="note">
                  Previously recorded manually · {sleepSummary.manualHours} hours
                </p>
              ) : null}
              <div className="sleep-tracker-entry-actions" aria-label="Record or edit sleep times">
                <Link
                  to="/ritual/sleep"
                  state={{ returnTo: "/ritual/sleep-tracker" }}
                  className="sleep-tracker-entry-link"
                >
                  {tonightBedtimeRecorded ? "Manage tonight’s bedtime" : "Record tonight’s bedtime"}
                </Link>
                <Link
                  to="/ritual/wake"
                  state={{ returnTo: "/ritual/sleep-tracker" }}
                  className="sleep-tracker-entry-link"
                >
                  {sleepSummary.wakeTime ? "Edit wake-up" : "Record wake-up"}
                </Link>
              </div>
            </div>
          ) : measurable ? (
            <>
              {isWorkoutRitual || isMeditationRitual || isLearnRitual || isCustomMeasurable ? (
                <div
                  className={isWorkoutRitual ? "workout-stepper" : isMeditationRitual ? "meditation-stepper" : isLearnRitual ? "learn-stepper" : "custom-stepper"}
                  role="group"
                  aria-label={isWorkoutRitual ? "Workout duration" : isMeditationRitual ? "Meditation duration" : isLearnRitual ? "Reading duration" : `${ritual.title} amount`}
                >
                  <button
                    className={isWorkoutRitual ? "workout-stepper-button" : isMeditationRitual ? "meditation-stepper-button" : isLearnRitual ? "learn-stepper-button" : "custom-stepper-button"}
                    type="button"
                    aria-label={`Decrease ${isWorkoutRitual ? "workout" : isMeditationRitual ? "meditation" : isLearnRitual ? "reading" : ritual.title} by one ${ritual.unit || "unit"}`}
                    disabled={!arcActive || saving || progressValue <= 0}
                    onClick={() => handleMeasuredStep(-1)}
                  >
                    −
                  </button>
                  <div className={isWorkoutRitual ? "workout-stepper-value" : isMeditationRitual ? "meditation-stepper-value" : isLearnRitual ? "learn-stepper-value" : "custom-stepper-value"} aria-live="polite">
                    <strong>
                      {formatValue(ritual, progressValue)}
                      <span> / {ritual.goal.toLocaleString()}</span>
                    </strong>
                    <em>{ritual.unit}</em>
                  </div>
                  <button
                    className={isWorkoutRitual ? "workout-stepper-button" : isMeditationRitual ? "meditation-stepper-button" : isLearnRitual ? "learn-stepper-button" : "custom-stepper-button"}
                    type="button"
                    aria-label={`Increase ${isWorkoutRitual ? "workout" : isMeditationRitual ? "meditation" : isLearnRitual ? "reading" : ritual.title} by one ${ritual.unit || "unit"}`}
                    disabled={!arcActive || saving}
                    onClick={() => handleMeasuredStep(1)}
                  >
                    +
                  </button>
                </div>
              ) : (
                <div className="ritual-metric">
                  <strong>
                    {formatValue(ritual, progressValue)}
                    {ranged ? (
                      <span> / {ritual.goalMin}–{ritual.goalMax}</span>
                    ) : (
                      <span> / {ritual.goal.toLocaleString()}</span>
                    )}
                  </strong>
                  <em>{ritual.unit}</em>
                </div>
              )}

              <div className={`ritual-track ${ranged ? "is-range" : ""}`}>
                {ranged ? (
                  <span
                    className="ritual-track-band"
                    style={{
                      left: `${(ritual.goalMin / ritual.goalMax) * 100}%`,
                    }}
                  />
                ) : null}
                <div
                  className="ritual-track-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {isSleepTrackerRitual ? (
                <div
                  className="sleep-duration-scale"
                  role="img"
                  aria-label={`Sleep duration reference from 6 to 9 hours${progressValue > 0 ? `. Recorded ${formatValue(ritual, progressValue)} hours` : ". No duration recorded"}.`}
                >
                  <div className="sleep-scale-track" aria-hidden="true">
                    <span className="sleep-scale-line" />
                    {[0, 100 / 3, 200 / 3, 100].map((position) => (
                      <span
                        key={position}
                        className="sleep-scale-tick"
                        style={{ left: `${position}%` }}
                      />
                    ))}
                    {progressValue > 0 ? (
                      <span
                        className="sleep-scale-marker"
                        style={{ left: `${sleepScalePercent}%` }}
                      />
                    ) : null}
                  </div>
                  <div className="sleep-scale-labels" aria-hidden="true">
                    <span>6h</span>
                    <span>7h</span>
                    <span>8h</span>
                    <span>9h</span>
                  </div>
                </div>
              ) : null}

              {isWaterRitual ? (
                <div className="water-glasses" role="group" aria-label="Water glasses">
                  {Array.from({ length: ritual.goal }, (_, index) => {
                    const filled = index < waterFilledCount;
                    const canAdd = index === waterNextIndex;
                    const canRemove = index === waterLastFilledIndex;
                    const action = canAdd
                      ? "Add one glass"
                      : canRemove
                        ? "Remove one glass"
                        : null;

                    return (
                      <button
                        key={index}
                        type="button"
                        className={`water-glass ${filled ? "is-filled" : ""}`}
                        disabled={!arcActive || !action || saving}
                        aria-label={`Glass ${index + 1} of ${ritual.goal}, ${filled ? "filled" : "empty"}${action ? `. ${action}.` : "."}`}
                        aria-pressed={filled}
                        onClick={() => handleWaterGlassStep(canAdd ? 1 : -1)}
                      >
                        <svg viewBox="0 0 24 30" aria-hidden="true" focusable="false">
                          <path d="M12 2.5C9.4 6.4 4.8 11 4.8 17a7.2 7.2 0 0 0 14.4 0c0-6-4.6-10.6-7.2-14.5Z" />
                        </svg>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {ranged ? (
                <p className="ritual-range-note">{rangeNote(status)}</p>
              ) : null}

              <label className="ritual-input-label">
                {ranged ? "Hours slept" : "Today's amount"}
                <input
                  type="number"
                  min="0"
                  max={ranged ? 16 : ritual.goal * 3}
                  step={ranged ? "0.1" : "1"}
                  value={draftValue}
                  onChange={handleValueChange}
                  disabled={!arcActive || saving}
                  placeholder="0"
                />
              </label>
            </>
          ) : isFoodRitual ? (
            <div className="healthy-meals-control">
              <p className="healthy-meals-count" aria-live="polite">
                {healthyMealsCount} of 3 meals · {healthyMealsCount >= 2 ? "complete" : "two complete your ritual"}
              </p>
              {(entry?.completed && (entry?.value === null || entry?.value === undefined)) ? (
                <p className="healthy-meals-legacy" role="status">
                  This day was completed before meal tracking was introduced.
                </p>
              ) : null}
              <div className="healthy-meals-options" role="group" aria-label="Meals eaten today">
                {["Breakfast", "Lunch", "Dinner"].map((meal, index) => {
                  const selected = Boolean(healthyMealsMask & (1 << index));
                  return (
                    <button
                      key={meal}
                      type="button"
                      className={`healthy-meal-option ${selected ? "is-selected" : ""}`}
                      aria-pressed={selected}
                      disabled={saving || !arcActive}
                      onClick={() => handleMealToggle(index)}
                    >
                      <span aria-hidden="true">{selected ? "✓" : "＋"}</span>
                      {meal}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            isSunscreenRitual ? (
              <div className="sunscreen-cycle" aria-live="polite">
                {lastApplicationTime ? (
                  <>
                    <p className="sunscreen-cycle-state">
                      {applicationCount > 1 ? "SPF re-applied" : "SPF applied"}
                    </p>
                    <p className="sunscreen-cycle-time">
                      {applicationCount > 1 ? "Re-applied at " : "Applied at "}
                      <time dateTime={lastApplicationTime}>{formatLocalTime(lastApplicationTime)}</time>
                    </p>
                    <ol className="sunscreen-application-list" aria-label="Today's sunscreen application times">
                      {validApplicationTimes.map((timestamp, index) => (
                        <li key={`${timestamp}-${index}`}>
                          <span>{index === 0 ? "First application" : `Re-application ${index}`}</span>
                          <time dateTime={timestamp}>{formatLocalTime(timestamp)}</time>
                        </li>
                      ))}
                    </ol>
                    {nextApplicationTime ? (
                      <div className="sunscreen-next-time">
                        <span>Next application</span>
                        <time dateTime={nextApplicationTime}>{formatLocalTime(nextApplicationTime)}</time>
                      </div>
                    ) : (
                      <p className="sunscreen-cycle-cutoff">Daytime SPF routine complete.</p>
                    )}
                  </>
                ) : (
                  <p className="sunscreen-cycle-prompt">Not yet applied today.</p>
                )}
              </div>
            ) : (
              isSkincareRitual ? (
                <div className="skincare-guidance">
                  <ol>
                    <li>Wash your face.</li>
                    <li>Apply moisturizer.</li>
                  </ol>
                  <p className="ritual-presence">
                    {isComplete
                      ? "You kept this promise tonight."
                      : "A quiet act of care before bed."}
                  </p>
                  {skincareLocked ? (
                    <p className="skincare-time-lock" role="status">
                      This evening ritual opens at 8:00 PM local time.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="ritual-presence">
                  {isComplete
                    ? "You kept this promise today."
                    : isSleepOnTimeRitual
                      ? sleepCompletionLocked
                        ? "The 11:00 PM local-time window has passed."
                        : "Mark this promise complete before 11:00 PM local time."
                  : "A quiet yes is enough."}
                </p>
              )
            )
          )}

          {ritual.id === "sleep" || ritual.id === "wake" ? (
            <label className="ritual-input-label sleep-time-input-label">
              {ritual.id === "sleep" ? "Time you went to sleep" : "Time you woke up"}
              <input
                type="time"
                max={ritual.id === "sleep" ? "22:59" : undefined}
                value={selectedLocalTime}
                onChange={(event) => setSelectedLocalTime(event.target.value)}
                disabled={!arcActive || saving || isComplete || (ritual.id === "sleep" && sleepCompletionLocked)}
                required
              />
            </label>
          ) : null}

          {ritual.id === "sleep-tracker" && Number.isInteger(entry?.calculatedDurationMinutes) ? (
            <p className="ritual-range-note" role="status">
              Calculated sleep · {formatSleepDuration(entry.calculatedDurationMinutes)}
            </p>
          ) : null}

          {!isFoodRitual && !isSleepTrackerRitual ? <button
            className={`ritual-complete ${isComplete ? "is-complete" : ""} ${justCompleted ? "is-pulse" : ""}`}
            onClick={handleAction}
            onAnimationEnd={() => setJustCompleted(false)}
            disabled={saving || !arcActive || skincareLocked || sleepCompletionLocked}
            type="button"
          >
            {saving ? "Saving…" : buttonLabel}
          </button> : null}

          {!arcActive ? (
            <p className="ritual-arc-ended" role="status">This {ARC_DURATION_DAYS}-day Winter Arc has ended. Your saved progress remains in your history.</p>
          ) : null}

          {cloudMode && saving ? <p className="ritual-cloud-save-state" role="status">{saveMessage}</p> : null}
          {cloudMode && saveMessage && !saving && !saveError ? <p className="ritual-cloud-save-state" role="status">{saveMessage}</p> : null}
          {cloudMode && saveError ? (
            <div className="ritual-cloud-save-error" role="alert">
              <p>{saveError}</p>
              {failedPatch ? (
                <button type="button" disabled={saving} onClick={() => persistCloudPatch(failedPatch)}>
                  Retry save
                </button>
              ) : null}
            </div>
          ) : null}
        </section>

        {!isSleepTrackerRitual ? <section className="ritual-card ritual-history">
          <p className="ritual-section-label">Your recent journey</p>

          <ul>
            {history.map((item) => (
              <li key={item.date}>
                <span>{formatHistoryDate(item.date)}</span>
                <span className="ritual-history-value">
                  {formatValue(ritual, item.value)}
                </span>
                <span
                  className={`ritual-history-mark ${item.inProgress ? "is-progress" : ""} ${item.completed ? "is-complete" : ""} ${item.mark === "✦" ? "is-above" : ""}`}
                >
                  {item.mark}
                </span>
              </li>
            ))}
          </ul>
        </section> : null}

        {!isSleepTrackerRitual ? <section className="ritual-stats">
          <div>
            <strong>
              {stats.streak}
              <em> {ritual.id === "sleep-tracker"
                ? (stats.streak === 1 ? "night" : "nights")
                : (stats.streak === 1 ? "day" : "days")}</em>
            </strong>
            <span>{ritual.id === "sleep-tracker" ? "Nights recorded in a row" : "Current streak"}</span>
          </div>
          <div>
            <strong>
              {stats.completedThisWeek} / {stats.weekTotal}
            </strong>
            <span>{ritual.id === "sleep-tracker" ? "Nights recorded this week" : "Completed this week"}</span>
          </div>
        </section> : null}
      </div>
    </main>
  );
}

export default RitualPage;
