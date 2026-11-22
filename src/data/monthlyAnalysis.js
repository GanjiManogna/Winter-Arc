import {
  addDays,
  getDaySnapshotFromProgress,
  getRecordedDatesFromProgress,
  getArcEndDateFromProgress,
  loadProgress,
  parseISODate,
  toISODate,
} from "./storage.js";
import { isInformationalRitual, toNumericValue } from "./ritualStatus.js";

function pad(value) {
  return String(value).padStart(2, "0");
}

export function getMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function shiftMonth(monthKey, amount) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1 + amount, 1);
  return getMonthKey(date);
}

function daysInMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

function getSleepNote(values) {
  if (values.length < 2) {
    return "Not enough sleep data to notice a clear pattern yet.";
  }

  const below = values.filter((value) => value < 7).length;
  const above = values.filter((value) => value > 9).length;
  const within = values.length - below - above;
  if (below > values.length / 2) {
    return "Your month carried a little less rest than your body may need.";
  }
  if (above > values.length / 2) {
    return "You gave yourself plenty of time to rest this month.";
  }
  if (within > values.length / 2) {
    return "Your rest stayed within a steady range this month.";
  }
  return "Your sleep varied across the month. Notice what seemed to support your rest.";
}

function reflectionText({ recordedDays, elapsedArcDays, habits, sleepValues }) {
  const strong = habits.filter((habit) =>
    habit.recordedDays >= 3 && habit.completedDays / habit.recordedDays >= 0.6
  );
  const movement = habits.some((habit) =>
    ["steps", "workout"].includes(habit.ritual.id) &&
    habit.recordedDays >= 3 && habit.completedDays / habit.recordedDays >= 0.5
  );
  const morning = strong.some((habit) => habit.ritual.id === "wake");
  const partialDays = habits.reduce((sum, habit) => sum + habit.partialDays, 0);
  const belowSleep = sleepValues.filter((value) => value < 7).length;
  const sleepMostlyBelow = sleepValues.length >= 2 && belowSleep > sleepValues.length / 2;
  const irregularRecording = elapsedArcDays >= 7 && recordedDays < elapsedArcDays / 2;

  let biggestWin = "Your first steps are still worth noticing.";
  if (recordedDays >= 3) {
    if (strong.length >= 3) {
      biggestWin = "You built consistency across several parts of your day.";
    } else if (movement) {
      biggestWin = "You kept showing up for movement throughout the month.";
    } else if (morning) {
      biggestWin = "You kept returning to your morning routine.";
    } else if (strong.length) {
      biggestWin = `You kept returning to ${strong[0].ritual.title.toLowerCase()}.`;
    } else if (sleepValues.length >= 2) {
      biggestWin = "You made space to notice what your rest needed.";
    }
  }

  let biggestLesson = "Patterns take time. Keep returning gently.";
  if (recordedDays >= 3) {
    if (sleepMostlyBelow) {
      biggestLesson = "Rest may be one of the foundations worth protecting.";
    } else if (partialDays > 0) {
      biggestLesson = "Progress showed up even when the full target wasn't reached.";
    } else if (irregularRecording) {
      biggestLesson = "Consistency begins with returning, even after quieter days.";
    } else {
      biggestLesson = "Small patterns become clearer when you keep noticing them.";
    }
  }

  let improve = "Keep exploring what helps you feel most consistent.";
  if (recordedDays >= 3) {
    if (sleepMostlyBelow) {
      improve = "Give your evenings a little more room for rest.";
    } else if (movement && strong.filter((habit) => ["steps", "workout"].includes(habit.ritual.id)).length === 0) {
      improve = "Create a little more space for movement.";
    } else if (partialDays > 0) {
      improve = "Let one small step bring a measurable ritual closer to its target.";
    } else if (irregularRecording) {
      improve = "Return to a small ritual on the quieter days, if it feels right.";
    }
  }

  return { biggestWin, biggestLesson, improve };
}

export function getMonthlyAnalysis(monthKey, todayISO = toISODate()) {
  return getMonthlyAnalysisFromProgress(loadProgress(), monthKey, todayISO);
}

export function getMonthlyAnalysisFromProgress(data, monthKey, todayISO = toISODate()) {
  const monthStart = `${monthKey}-01`;
  const monthEnd = `${monthKey}-${pad(daysInMonth(monthKey))}`;
  const arcStart = data.startDate;
  const arcEnd = getArcEndDateFromProgress(data);
  const start = [monthStart, arcStart].sort().at(-1);
  const end = [monthEnd, arcEnd, todayISO].sort()[0];
  const eligibleDates = [];

  if (start <= end) {
    for (let date = start; date <= end; date = addDays(date, 1)) {
      eligibleDates.push(date);
    }
  }

  const recordedSet = new Set(getRecordedDatesFromProgress(data));
  const snapshots = eligibleDates
    .filter((date) => recordedSet.has(date))
    .map((date) => getDaySnapshotFromProgress(data, date));
  const recordedDays = snapshots.length;
  const rituals = [...new Map(
    snapshots.flatMap((snapshot) => snapshot.rows.map((row) => [row.ritual.id, row.ritual]))
  ).values()].filter((ritual) => !isInformationalRitual(ritual));

  const habits = rituals.map((ritual) => {
    const observations = snapshots
      .map((snapshot) => snapshot.rows.find((row) => row.ritual.id === ritual.id))
      .filter(Boolean);
    const values = observations
      .map((row) => toNumericValue(row.status.value))
      .filter((value) => value > 0);

    return {
      ritual,
      recordedDays: observations.length,
      completedDays: observations.filter((row) => row.status.completed).length,
      partialDays: observations.filter((row) => row.status.inProgress).length,
      averageValue: values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0,
      valueCount: values.length,
    };
  });

  const sleepValues = snapshots
    .flatMap((snapshot) => snapshot.rows
      .filter((row) => row.ritual.id === "sleep-tracker")
      .map((row) => toNumericValue(row.status.value)))
    .filter((value) => value > 0);
  const totalCompleted = snapshots.reduce((sum, snapshot) => sum + snapshot.completedCount, 0);
  // Average only over recorded days; days without any stored activity are not
  // treated as evidence about the month.
  const averagePercent = recordedDays
    ? Math.round(snapshots.reduce((sum, snapshot) => {
        return sum + (snapshot.total ? snapshot.completedCount / snapshot.total * 100 : 0);
      }, 0) / recordedDays)
    : 0;
  const reflections = reflectionText({
    recordedDays,
    elapsedArcDays: eligibleDates.length,
    habits,
    sleepValues,
  });

  return {
    monthKey,
    monthLabel: parseISODate(monthStart).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    }),
    calendarDays: daysInMonth(monthKey),
    eligibleDays: eligibleDates.length,
    recordedDays,
    hasRecordedData: recordedDays > 0,
    totalCompleted,
    averagePercent,
    habits,
    sleep: {
      recorded: sleepValues.length,
      average: sleepValues.length
        ? sleepValues.reduce((sum, value) => sum + value, 0) / sleepValues.length
        : 0,
      lowest: sleepValues.length ? Math.min(...sleepValues) : 0,
      highest: sleepValues.length ? Math.max(...sleepValues) : 0,
      note: getSleepNote(sleepValues),
    },
    ...reflections,
    startDate: eligibleDates[0] || null,
    endDate: eligibleDates.at(-1) || null,
  };
}
