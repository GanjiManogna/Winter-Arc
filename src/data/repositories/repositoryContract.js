/**
 * Repository methods return a Promise of `{ data, error }` in both backends.
 * Dates use local ISO calendar-day keys; daily values retain the current
 * completed/value/completedAt/applicationTimes semantics.
 */
export const REPOSITORY_OPERATIONS = Object.freeze([
  "getProgramMetadata",
  "loadProgress",
  "readDailyEntries",
  "writeDailyEntry",
  "readRitualSnapshots",
  "writeRitualSnapshots",
  "readCustomHabits",
  "writeCustomHabit",
  "readCustomHabitDefinitions",
  "writeCustomHabitDefinition",
  "readWeeklyReflections",
  "writeWeeklyReflection",
  "readMonthlyReflections",
  "writeMonthlyReflection",
]);

export function hasRepositoryContract(repository) {
  return REPOSITORY_OPERATIONS.every((operation) => typeof repository?.[operation] === "function");
}

export function repositoryResult(data, error = null) {
  return { data, error };
}
