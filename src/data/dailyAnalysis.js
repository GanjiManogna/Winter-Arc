import {
  addDays,
  clampDateToArc,
  getArcEndDateFromProgress,
  getDaySnapshotFromProgress,
  loadProgress,
  toISODate,
} from "./storage.js";
import {
  isMeasurableRitual,
  isInformationalRitual,
  isRangeRitual,
  isTargetRitual,
  toNumericValue,
} from "./ritualStatus.js";

function formatAmount(value) {
  return toNumericValue(value).toLocaleString(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });
}

export function analysisMark(ritual, status) {
  if (isInformationalRitual(ritual)) {
    return status.value > 0 ? "·" : "—";
  }
  if (isRangeRitual(ritual)) {
    if (status.value <= 0) return "—";
    if (status.rangeState === "below") return "◐";
    return "✓";
  }
  if (isMeasurableRitual(ritual)) {
    if (status.completed) return "✓";
    if (status.inProgress) return "◐";
    return "—";
  }
  return status.completed ? "✓" : "○";
}

export function analysisValue(ritual, status) {
  if (isRangeRitual(ritual)) {
    if (status.value <= 0) return "";
    const hours = formatAmount(status.value);
    return `${hours} ${status.value === 1 ? "hour" : "hours"}`;
  }
  if (isTargetRitual(ritual)) {
    if (status.value <= 0) {
      return `0 / ${ritual.goal.toLocaleString()} ${ritual.unit || ""}`.trim();
    }
    return `${formatAmount(status.value)} / ${ritual.goal.toLocaleString()} ${ritual.unit || ""}`.trim();
  }
  return "";
}

export function getSleepReflection(snapshot) {
  const sleep = snapshot.rows.find((row) => row.ritual.id === "sleep-tracker");
  if (!sleep || sleep.status.value <= 0) {
    return "Sleep wasn't recorded today.";
  }
  if (sleep.status.rangeState === "below") {
    return "Your body may need a little more rest tonight.";
  }
  if (sleep.status.rangeState === "above") {
    return "You gave yourself plenty of rest. Listen to what your body needs.";
  }
  return "You gave yourself space to rest. Let that support tomorrow.";
}

export function getDayReflection(snapshot) {
  const { completedCount, total, rows } = snapshot;
  const hasPartial = rows.some((row) => row.status.inProgress);
  const incomplete = rows.filter(
    (row) => !isInformationalRitual(row.ritual) && !row.status.completed
  ).length;

  let message = "Today was a beginning. You don't have to finish everything to keep going.";
  if (total > 0 && completedCount === total) {
    message = "You kept your promise to yourself today. ✦";
  } else if (completedCount >= 7) {
    message = "You gave a lot to yourself today. Notice that.";
  } else if (completedCount >= 4) {
    message = "You're building consistency. Keep returning to what matters.";
  } else if (completedCount >= 1) {
    message = "You showed up today. Small steps still count.";
  }

  const notes = [];
  if (hasPartial) {
    notes.push("Some things were still in progress today. That's part of the journey.");
  }

  let tomorrow = "Return to the things that mattered today.";
  if (total > 0 && completedCount === total) {
    tomorrow = "Carry what worked today into tomorrow.";
  } else if (incomplete <= 1 || (total > 0 && completedCount / total >= 0.8)) {
    tomorrow = "Carry what worked today into tomorrow.";
  } else if (incomplete >= 3) {
    tomorrow = "You can choose one small thing to begin with tomorrow.";
  }

  return { message, notes, tomorrow };
}

export function getDailyAnalysis(dateISO = toISODate()) {
  return getDailyAnalysisFromProgress(loadProgress(), dateISO);
}

export function getDailyAnalysisFromProgress(progress, dateISO = toISODate()) {
  const activeDate = clampDateToArc(progress, dateISO);
  const arcEnd = getArcEndDateFromProgress(progress);
  const snapshot = getDaySnapshotFromProgress(progress, activeDate);
  const recorded = snapshot.rows.some((row) => {
    if (row.status.completed || row.status.inProgress) return true;
    return toNumericValue(row.status.value) > 0;
  });

  const percent = snapshot.total
    ? Math.round((snapshot.completedCount / snapshot.total) * 100)
    : 0;

  return {
    iso: activeDate,
    snapshot,
    recorded,
    percent,
    reflection: getDayReflection(snapshot),
    sleep: getSleepReflection(snapshot),
    wentWell: snapshot.rows.filter((row) => row.status.completed),
    previousIso: activeDate > progress.startDate ? addDays(activeDate, -1) : activeDate,
    nextIso: activeDate < arcEnd ? addDays(activeDate, 1) : activeDate,
  };
}
