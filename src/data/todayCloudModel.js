import { RITUALS } from "./rituals.js";
import { customHabitToRitual, getDayNumberFromProgress, isDateWithinArc, toISODate, withCalculatedSleepDuration } from "./storage.js";

function withSleepTrackerLast(rituals) {
  const sleepTracker = rituals.find((ritual) => ritual.id === "sleep-tracker");
  return [...rituals.filter((ritual) => ritual.id !== "sleep-tracker"), ...(sleepTracker ? [sleepTracker] : [])];
}

/** Derives only the Today view from the already-loaded cloud progress object. */
export function createTodayCloudModel(progress, date = new Date()) {
  if (!progress || typeof progress !== "object") return null;
  const dateISO = toISODate(date);
  const customRituals = (progress.customHabits || [])
    .filter((habit) => !habit.archived)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(customHabitToRitual);

  return {
    entries: isDateWithinArc(progress, dateISO) ? withCalculatedSleepDuration(progress, dateISO) : {},
    rituals: withSleepTrackerLast([...RITUALS, ...customRituals]),
    dayNumber: getDayNumberFromProgress(progress, date),
    arcActive: isDateWithinArc(progress, dateISO),
  };
}
