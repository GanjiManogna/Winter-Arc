import {
  saveMonthlyIntention,
  loadProgress as loadLocalProgress,
  saveProgress as saveLocalProgress,
  saveWeeklyReflection,
  upsertRitualEntry,
} from "../storage.js";
import { repositoryResult } from "./repositoryContract.js";

function withStorage(operation) {
  try {
    return Promise.resolve(repositoryResult(operation()));
  } catch (error) {
    const code = error?.message === "CUSTOM_HABIT_NOT_FOUND" ? error.message : "LOCAL_STORAGE_FAILED";
    return Promise.resolve(repositoryResult(null, { code }));
  }
}

function currentProgress() {
  return loadLocalProgress();
}

export const localRepository = Object.freeze({
  async loadProgress() {
    return withStorage(() => currentProgress());
  },

  async getProgramMetadata() {
    return withStorage(() => {
      const progress = currentProgress();
      return { id: null, userId: null, startDate: progress.startDate, sourceSchemaVersion: progress.version };
    });
  },

  async readDailyEntries(dateISO = null) {
    return withStorage(() => {
      const entries = currentProgress().entries || {};
      const dates = dateISO ? [dateISO] : Object.keys(entries).sort();
      return dates.flatMap((date) => Object.entries(entries[date] || {}).map(([ritualId, entry]) => ({
        date,
        ritualId,
        completed: entry.completed ?? false,
        value: entry.value ?? null,
        completedAt: entry.completedAt ?? null,
        ...(entry.sleepTime != null ? { sleepTime: entry.sleepTime } : {}),
        ...(entry.wakeTime != null ? { wakeTime: entry.wakeTime } : {}),
        applicationTimes: entry.applicationTimes ?? [],
      })));
    });
  },

  async writeDailyEntry(dateISO, ritualId, patch) {
    return withStorage(() => {
      const entry = upsertRitualEntry(ritualId, patch, dateISO);
      return {
        date: dateISO, ritualId,
        completed: entry.completed ?? false,
        value: entry.value ?? null,
        completedAt: entry.completedAt ?? null,
        ...(entry.sleepTime != null ? { sleepTime: entry.sleepTime } : {}),
        ...(entry.wakeTime != null ? { wakeTime: entry.wakeTime } : {}),
        applicationTimes: entry.applicationTimes ?? [],
      };
    });
  },

  async readRitualSnapshots(dateISO = null) {
    return withStorage(() => {
      const snapshots = currentProgress().ritualSnapshots || {};
      const dates = dateISO ? [dateISO] : Object.keys(snapshots).sort();
      return dates.flatMap((date) => (snapshots[date] || []).map((definition, position) => ({
        date, ritualId: definition.id, position, definition,
      })));
    });
  },

  async writeRitualSnapshots(dateISO, definitions) {
    return withStorage(() => {
      const progress = currentProgress();
      const ritualSnapshots = { ...(progress.ritualSnapshots || {}), [dateISO]: definitions };
      saveLocalProgress({ ...progress, ritualSnapshots });
      return definitions.map((definition, position) => ({ date: dateISO, ritualId: definition.id, position, definition }));
    });
  },

  async readCustomHabits() {
    return withStorage(() => currentProgress().customHabits || []);
  },

  async writeCustomHabit(habit) {
    return withStorage(() => {
      const progress = currentProgress();
      const habits = [...(progress.customHabits || [])];
      const index = habits.findIndex((item) => item.id === habit.id);
      if (index < 0) habits.push(habit);
      else habits[index] = { ...habits[index], ...habit };
      saveLocalProgress({ ...progress, customHabits: habits });
      return habit;
    });
  },

  async readCustomHabitDefinitions(customHabitId = null) {
    return withStorage(() => {
      const progress = currentProgress();
      const current = (progress.customHabits || [])
        .filter((habit) => !customHabitId || habit.id === customHabitId)
        .map((habit) => ({ customHabitId: habit.id, version: 1, effectiveFrom: habit.createdAt, definition: habit }));
      const historical = Object.entries(progress.ritualSnapshots || {}).flatMap(([date, definitions]) =>
        (definitions || [])
          .filter((definition) => definition.source === "custom" && (!customHabitId || definition.id === customHabitId))
          .map((definition) => ({ customHabitId: definition.id, version: null, effectiveFrom: date, definition }))
      );
      return [...historical, ...current];
    });
  },

  async writeCustomHabitDefinition(customHabitId, definition) {
    return withStorage(() => {
      const progress = currentProgress();
      const habits = (progress.customHabits || []).map((habit) => (
        habit.id === customHabitId ? { ...habit, ...definition, id: habit.id } : habit
      ));
      if (!habits.some((habit) => habit.id === customHabitId)) {
        throw new Error("CUSTOM_HABIT_NOT_FOUND");
      }
      saveLocalProgress({ ...progress, customHabits: habits });
      return definition;
    });
  },

  async readWeeklyReflections(weekStart = null) {
    return withStorage(() => {
      const records = currentProgress().weeklyReflections || {};
      const keys = weekStart ? [weekStart] : Object.keys(records).sort();
      return keys.filter((key) => records[key]).map((key) => ({ weekStart: key, ...records[key] }));
    });
  },

  async writeWeeklyReflection(weekStart, reflection) {
    return withStorage(() => ({ weekStart, ...saveWeeklyReflection(weekStart, reflection) }));
  },

  async readMonthlyReflections(month = null) {
    return withStorage(() => {
      const records = currentProgress().monthlyReflections || {};
      const keys = month ? [month] : Object.keys(records).sort();
      return keys.filter((key) => records[key]).map((key) => ({ month: key, ...records[key] }));
    });
  },

  async writeMonthlyReflection(month, reflection) {
    return withStorage(() => ({ month, ...saveMonthlyIntention(month, reflection?.intention ?? "") }));
  },
});
