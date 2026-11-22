import {
  addDays,
  getCalendarDayDifference,
  getDaySnapshotFromProgress,
  getRecordedDatesFromProgress,
  getArcWeekStartIsoFromProgress,
  getArcEndDateFromProgress,
  clampDateToArc,
  loadProgress,
  parseISODate,
  toISODate,
} from "./storage.js";
import { isTargetRitual, toNumericValue } from "./ritualStatus.js";
import { analysisMark } from "./dailyAnalysis.js";

function formatShortDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
  });
}

export function getWeekStartIso(iso = toISODate()) {
  return getWeekStartIsoFromProgress(loadProgress(), iso);
}

export function getWeekStartIsoFromProgress(progress, iso = toISODate()) {
  return getArcWeekStartIsoFromProgress(progress, iso);
}

export function shiftWeek(weekStartIso, delta) {
  return shiftWeekFromProgress(loadProgress(), weekStartIso, delta);
}

export function shiftWeekFromProgress(progress, weekStartIso, delta, today = toISODate()) {
  const { startDate } = progress;
  const next = addDays(weekStartIso, delta * 7);
  if (parseISODate(next) < parseISODate(startDate)) {
    return startDate;
  }
  const currentStart = getWeekStartIsoFromProgress(progress, today);
  if (parseISODate(next) > parseISODate(currentStart)) {
    return currentStart;
  }
  return next;
}

export function getWeeklyCheckin(weekStartIso = getWeekStartIso()) {
  return getWeeklyCheckinFromProgress(loadProgress(), weekStartIso);
}

export function getWeeklyCheckinFromProgress(progress, weekStartIso = getWeekStartIsoFromProgress(progress), today = toISODate()) {
  weekStartIso = getArcWeekStartIsoFromProgress(progress, weekStartIso);
  const arcEndIso = getArcEndDateFromProgress(progress);
  const weekEndIso = [addDays(weekStartIso, 6), arcEndIso].sort()[0];
  const weekNumber = Math.floor(
    getCalendarDayDifference(progress.startDate, weekStartIso) / 7
  ) + 1;
  const boundedToday = clampDateToArc(progress, today);
  const isCurrent = today >= progress.startDate && today <= arcEndIso
    && boundedToday >= weekStartIso && boundedToday <= weekEndIso;
  const dates = [];

  for (let date = weekStartIso; date <= weekEndIso; date = addDays(date, 1)) {
    dates.push(date);
  }

  const elapsed = dates.filter((iso) => iso <= today && iso <= arcEndIso);
  const recordedSet = new Set(getRecordedDatesFromProgress(progress));
  const snapshots = elapsed.map((iso) => getDaySnapshotFromProgress(progress, iso));
  const recordedSnapshots = snapshots.filter((snapshot) => recordedSet.has(snapshot.iso));
  // Each elapsed date uses its historically active rituals; the snapshot total
  // is the completion-oriented denominator (informational sleep is excluded).
  const rituals = [...new Map(
    snapshots.flatMap((snapshot) => snapshot.rows.map((row) => [row.ritual.id, row.ritual]))
  ).values()];

  const totalCompleted = snapshots.reduce((sum, snapshot) => sum + snapshot.completedCount, 0);
  // Unrecorded elapsed days contribute 0%; each date uses its own
  // historically active, completion-oriented ritual denominator.
  const averagePercent = elapsed.length
    ? Math.round(
        snapshots.reduce((sum, snapshot) => {
          return sum + (snapshot.total ? (snapshot.completedCount / snapshot.total) * 100 : 0);
        }, 0) / elapsed.length
      )
    : 0;

  const patterns = rituals.map((ritual) => {
    const days = dates.map((iso) => {
      if (iso > today) {
        return { iso, mark: "", future: true, status: null };
      }
      const snapshot = snapshots.find((item) => item.iso === iso);
      const row = snapshot?.rows.find((item) => item.ritual.id === ritual.id);
      const status = row?.status;
      return {
        iso,
        future: false,
        status,
        mark: analysisMark(ritual, status || { completed: false, inProgress: false, value: 0 }),
      };
    });

    const lived = days.filter((day) => !day.future);
    const completedDays = lived.filter((day) => day.status?.completed).length;
    const partialDays = lived.filter((day) => day.status?.inProgress).length;
    const values = lived
      .map((day) => toNumericValue(day.status?.value))
      .filter((value) => value > 0);
    const averageValue = values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;

    return {
      ritual,
      days,
      completedDays,
      partialDays,
      averageValue,
      recordedValues: values.length,
    };
  });

  const sleep = patterns.find((item) => item.ritual.id === "sleep-tracker");
  const sleepValues = sleep?.days
    .filter((day) => !day.future)
    .map((day) => toNumericValue(day.status?.value))
    .filter((value) => value > 0) || [];

  let sleepNote = "Not enough sleep data to notice a clear pattern yet.";
  if (sleepValues.length >= 2) {
    const below = sleepValues.filter((value) => value < 7).length;
    const above = sleepValues.filter((value) => value > 9).length;
    const within = sleepValues.length - below - above;
    if (below > sleepValues.length / 2) {
      sleepNote = "Your week carried a little less rest than your body may need.";
    } else if (above > sleepValues.length / 2) {
      sleepNote = "You gave yourself plenty of time to rest this week.";
    } else if (within > sleepValues.length / 2) {
      sleepNote = "Your rest stayed within a steady range this week.";
    } else {
      sleepNote = "Your sleep varied across the week. Notice what your body seemed to need.";
    }
  }

  const wins = [];
  const challenges = [];

  patterns.forEach((pattern) => {
    const { ritual, completedDays, partialDays } = pattern;
    const title = ritual.title.toLowerCase();
    if (completedDays >= 3) {
      if (ritual.id === "water") {
        wins.push(`You kept your water goal on ${completedDays} days.`);
      } else if (ritual.id === "steps") {
        wins.push(`You reached your step goal ${completedDays} times.`);
      } else if (isTargetRitual(ritual)) {
        wins.push(`You reached your ${title} goal ${completedDays} times.`);
      } else {
        wins.push(`You showed up for ${title} ${completedDays} times.`);
      }
    }

    if (completedDays <= 2 && partialDays >= 2) {
      challenges.push(`Your ${title} goal was reached on some days and partial on others.`);
    } else if (completedDays <= 1 && recordedSnapshots.length >= 2 && ritual.id !== "sleep-tracker") {
      challenges.push(`Your ${title} routine was still finding its rhythm.`);
    }
  });

  const uniqueChallenges = [...new Set(challenges)].slice(0, 3);
  const uniqueWins = wins.slice(0, 4);

  let focus = "Protect what is already working.";
  const water = patterns.find((item) => item.ritual.id === "water");
  const steps = patterns.find((item) => item.ritual.id === "steps");
  const workout = patterns.find((item) => item.ritual.id === "workout");

  if (sleepValues.length >= 2 && sleepValues.filter((value) => value < 7).length > sleepValues.length / 2) {
    focus = "Give your evenings a little more space for rest.";
  } else if ((steps && steps.completedDays <= 2) || (workout && workout.completedDays <= 2)) {
    focus = "Return to movement in small, repeatable ways.";
  } else if (water && water.completedDays <= 2) {
    focus = "Keep water within easy reach throughout the day.";
  }

  return {
    weekStartIso,
    weekEndIso,
    weekNumber,
    isCurrent,
    rangeLabel: `${formatShortDate(weekStartIso)} — ${formatShortDate(weekEndIso)}`,
    daysInWeek: dates.length,
    recordedDays: recordedSnapshots.length,
    totalCompleted,
    averagePercent,
    elapsedDays: elapsed.length,
    patterns,
    sleep: {
      recorded: sleepValues.length,
      average: sleepValues.length
        ? sleepValues.reduce((sum, value) => sum + value, 0) / sleepValues.length
        : 0,
      note: sleepNote,
    },
    wins: uniqueWins,
    challenges:
      recordedSnapshots.length < 2
        ? ["Not enough recorded days to notice a clear pattern yet."]
        : uniqueChallenges.length
          ? uniqueChallenges
          : ["Not enough recorded days to notice a clear pattern yet."],
    focus,
    previousWeek: shiftWeekFromProgress(progress, weekStartIso, -1, today),
    nextWeek: shiftWeekFromProgress(progress, weekStartIso, 1, today),
  };
}
