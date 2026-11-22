import { isLocalTime } from "../sleepDuration.js";

const INVALID_CLOUD_DATA = Object.freeze({
  code: "CLOUD_DATA_INVALID",
  message: "Cloud Winter Arc data is incomplete or malformed and could not be loaded safely.",
});

function invalid() {
  return { data: null, error: INVALID_CLOUD_DATA };
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finiteValue(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeMonth(value) {
  if (!isISODate(value) || !/^\d{4}-\d{2}-01$/.test(value)) return null;
  return value.slice(0, 7);
}

function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function normalizeHabit(habit, definition) {
  if (!habit || typeof habit.source_habit_id !== "string" || !habit.source_habit_id
    || !isTimestamp(habit.created_at)
    || typeof definition?.title !== "string" || !definition.title.trim()) return null;
  const type = definition.habit_type;
  if (type !== "boolean" && type !== "measurable") return null;
  const goal = type === "measurable" ? finiteValue(definition.goal) : null;
  if (type === "measurable" && (!definition.unit || goal === null || goal <= 0)) return null;
  return {
    id: habit.source_habit_id,
    title: definition.title,
    type,
    unit: type === "measurable" ? definition.unit : null,
    goal,
    icon: definition.icon || "✦",
    theme: definition.theme || "clarity",
    shortDescription: definition.short_description || "",
    createdAt: habit.created_at,
    archived: Boolean(habit.archived),
    order: Number.isFinite(Number(habit.display_order)) ? Number(habit.display_order) : 0,
    revision: Number(habit.revision) > 0 ? Number(habit.revision) : 1,
    definitionRevision: Number(definition.revision) > 0 ? Number(definition.revision) : 1,
  };
}

/** Convert the authenticated program's normalized cloud rows into storage.js's logical model. */
export function reconstructCloudProgress({
  program,
  dailyEntries = [],
  ritualSnapshots = [],
  customHabits = [],
  customHabitDefinitions = [],
  weeklyReflections = [],
  monthlyReflections = [],
} = {}) {
  if (!isObject(program) || typeof program.id !== "string" || typeof program.user_id !== "string"
    || !isISODate(program.start_date)
    || (program.source_schema_version != null && (!Number.isInteger(Number(program.source_schema_version)) || Number(program.source_schema_version) < 1))
    || ![dailyEntries, ritualSnapshots, customHabits, customHabitDefinitions, weeklyReflections, monthlyReflections].every(Array.isArray)) {
    return invalid();
  }
  const ownedByProgram = (rows) => rows.every((row) => isObject(row)
    && row.program_id === program.id && row.user_id === program.user_id);
  if (![dailyEntries, ritualSnapshots, customHabits, customHabitDefinitions, weeklyReflections, monthlyReflections].every(ownedByProgram)) return invalid();

  const entries = {};
  for (const row of dailyEntries) {
    if (!isObject(row) || !isISODate(row.entry_date)
      || typeof row.ritual_id !== "string" || !row.ritual_id || typeof row.completed !== "boolean"
      || !["boolean", "measurable", "informational"].includes(row.record_kind)
      || (row.value != null && finiteValue(row.value) === null)
      || (row.completed_at != null && !isTimestamp(row.completed_at))
      || (row.sleep_time != null && !isLocalTime(row.sleep_time))
      || (row.wake_time != null && !isLocalTime(row.wake_time))
      || (row.sleep_time != null && row.ritual_id !== "sleep")
      || (row.wake_time != null && row.ritual_id !== "wake")
      || !Array.isArray(row.application_times)
      || row.application_times.some((timestamp) => typeof timestamp !== "string")) {
      return invalid();
    }
    const informational = row.record_kind === "informational" || row.ritual_id === "sleep-tracker";
    if (informational && (row.completed || row.completed_at != null)) return invalid();
    const day = entries[row.entry_date] || (entries[row.entry_date] = {});
    if (day[row.ritual_id]) return invalid();
    day[row.ritual_id] = {
      completed: informational ? false : row.completed,
      value: finiteValue(row.value),
      completedAt: informational ? null : row.completed_at ?? null,
      ...(row.sleep_time != null ? { sleepTime: row.sleep_time } : {}),
      ...(row.wake_time != null ? { wakeTime: row.wake_time } : {}),
      applicationTimes: [...row.application_times],
      revision: Number(row.revision) > 0 ? Number(row.revision) : 1,
    };
  }

  const snapshots = {};
  const snapshotRows = [...ritualSnapshots].sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date))
    || Number(a.position) - Number(b.position));
  for (const row of snapshotRows) {
    if (!isObject(row) || !isISODate(row.snapshot_date)
      || typeof row.ritual_id !== "string" || !row.ritual_id || !Number.isInteger(Number(row.position))
      || !isObject(row.definition) || row.definition.id !== row.ritual_id) return invalid();
    const list = snapshots[row.snapshot_date] || (snapshots[row.snapshot_date] = []);
    if (Number(row.position) !== list.length || list.some((definition) => definition.id === row.ritual_id)) return invalid();
    list.push(row.definition);
  }

  const definitionsById = new Map();
  for (const definition of customHabitDefinitions) {
    if (!isObject(definition) || typeof definition.custom_habit_id !== "string"
      || !Number.isInteger(Number(definition.version)) || Number(definition.version) < 1
      || !isTimestamp(definition.effective_from)) return invalid();
    const current = definitionsById.get(definition.custom_habit_id);
    if (!current || Number(definition.version) > Number(current.version)) definitionsById.set(definition.custom_habit_id, definition);
  }
  if ([...definitionsById.keys()].some((id) => !customHabits.some((habit) => habit.id === id))) return invalid();
  const habits = [];
  const habitIds = new Set();
  for (const habit of customHabits) {
    if (!isObject(habit) || typeof habit.id !== "string" || habitIds.has(habit.id)) return invalid();
    habitIds.add(habit.id);
    const definition = definitionsById.get(habit.id);
    const normalized = normalizeHabit(habit, definition);
    if (!normalized) return invalid();
    habits.push(normalized);
  }
  habits.sort((a, b) => a.order - b.order);

  const weekly = {};
  for (const row of weeklyReflections) {
    if (!isObject(row) || !isISODate(row.week_start)
      || [row.wins, row.challenges, row.focus].some((value) => typeof value !== "string") || weekly[row.week_start]) return invalid();
    weekly[row.week_start] = { wins: row.wins, challenges: row.challenges, focus: row.focus, revision: Number(row.revision) > 0 ? Number(row.revision) : 1 };
  }

  const monthly = {};
  for (const row of monthlyReflections) {
    const month = normalizeMonth(row?.month);
    if (!isObject(row) || !month || typeof row.intention !== "string" || monthly[month]) return invalid();
    monthly[month] = { intention: row.intention, revision: Number(row.revision) > 0 ? Number(row.revision) : 1 };
  }

  return {
    data: {
      version: Number.isInteger(Number(program.source_schema_version)) ? Number(program.source_schema_version) : 1,
      startDate: program.start_date,
      entries,
      customHabits: habits,
      ritualSnapshots: snapshots,
      weeklyReflections: weekly,
      monthlyReflections: monthly,
    },
    error: null,
  };
}
