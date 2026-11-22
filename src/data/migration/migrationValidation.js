import { RITUAL_BY_ID } from "../rituals.js";
import { isLocalTime } from "../sleepDuration.js";

const ROOT_KEYS = new Set([
  "version", "startDate", "entries", "customHabits", "ritualSnapshots",
  "weeklyReflections", "monthlyReflections",
]);
const ENTRY_KEYS = new Set(["completed", "value", "completedAt", "applicationTimes", "sleepTime", "wakeTime"]);
const HABIT_KEYS = new Set([
  "id", "title", "type", "unit", "goal", "icon", "theme", "shortDescription",
  "createdAt", "archived", "order",
]);
const WEEKLY_KEYS = new Set(["wins", "challenges", "focus"]);
const MONTHLY_KEYS = new Set(["intention"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimestamp(value) {
  return typeof value === "string"
    && /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/i.test(value)
    && isDate(value.slice(0, 10))
    && !Number.isNaN(Date.parse(value));
}

function issue(list, code, path, message) {
  list.push({ code, path, message });
}

function checkUnknownKeys(record, allowed, path, errors) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) issue(errors, "UNMAPPED_FIELD", `${path}.${key}`, "This field has no destination column; migration would otherwise discard it.");
  }
}

function emptyMapIfMissing(data, key, warnings) {
  if (data[key] === undefined) {
    warnings.push({ code: "MISSING_CONTAINER_DEFAULTED", path: key, message: `Missing ${key} was safely treated as empty.` });
    data[key] = {};
  }
}

export function validateLocalData(rawValue) {
  const errors = [];
  const warnings = [];
  let data;

  if (rawValue === null || rawValue === undefined) {
    issue(errors, "LOCAL_DATA_MISSING", "winterArc.progress.v1", "No local progress record exists to migrate.");
  } else {
    try {
      data = typeof rawValue === "string" ? JSON.parse(rawValue) : structuredClone(rawValue);
    } catch {
      issue(errors, "INVALID_JSON", "winterArc.progress.v1", "The local progress value is not valid JSON.");
    }
  }

  if (data !== undefined) {
    if (!isRecord(data)) {
      issue(errors, "INVALID_ROOT", "$", "The local progress value must be a JSON object.");
    } else {
      checkUnknownKeys(data, ROOT_KEYS, "$", errors);
      if (data.version !== 1) issue(errors, "UNSUPPORTED_VERSION", "version", "Only local progress schema version 1 is supported.");
      if (!isDate(data.startDate)) issue(errors, "INVALID_START_DATE", "startDate", "A valid YYYY-MM-DD arc start date is required.");

      for (const key of ["entries", "ritualSnapshots", "weeklyReflections", "monthlyReflections"]) {
        if (data[key] === undefined) emptyMapIfMissing(data, key, warnings);
        else if (!isRecord(data[key])) issue(errors, "INVALID_CONTAINER", key, `${key} must be an object keyed by date or period.`);
      }
      if (data.customHabits === undefined) {
        warnings.push({ code: "MISSING_CONTAINER_DEFAULTED", path: "customHabits", message: "Missing customHabits was safely treated as empty." });
        data.customHabits = [];
      } else if (!Array.isArray(data.customHabits)) {
        issue(errors, "INVALID_CONTAINER", "customHabits", "customHabits must be an array.");
      }

      const customIds = new Set();
      if (Array.isArray(data.customHabits)) {
        data.customHabits.forEach((habit, index) => {
          const path = `customHabits[${index}]`;
          if (!isRecord(habit)) {
            issue(errors, "INVALID_CUSTOM_HABIT", path, "A custom habit must be an object.");
            return;
          }
          checkUnknownKeys(habit, HABIT_KEYS, path, errors);
          if (typeof habit.id !== "string" || !habit.id.trim()) issue(errors, "INVALID_CUSTOM_HABIT_ID", `${path}.id`, "A stable non-empty string ID is required.");
          else if (Object.hasOwn(RITUAL_BY_ID, habit.id)) issue(errors, "CUSTOM_HABIT_ID_COLLISION", `${path}.id`, "Custom habit IDs cannot collide with built-in ritual IDs.");
          else if (customIds.has(habit.id)) issue(errors, "DUPLICATE_CUSTOM_HABIT_ID", `${path}.id`, "Custom habit IDs must be unique.");
          else customIds.add(habit.id);
          if (typeof habit.title !== "string" || !habit.title.trim()) issue(errors, "INVALID_CUSTOM_HABIT_TITLE", `${path}.title`, "A non-empty title is required.");
          if (!["boolean", "measurable"].includes(habit.type)) issue(errors, "INVALID_CUSTOM_HABIT_TYPE", `${path}.type`, "Habit type must be boolean or measurable.");
          if (habit.createdAt !== undefined && !isTimestamp(habit.createdAt)) issue(errors, "INVALID_CUSTOM_HABIT_DATE", `${path}.createdAt`, "createdAt must be an ISO timestamp.");
          if (habit.createdAt === undefined) issue(errors, "MISSING_CUSTOM_HABIT_DATE", `${path}.createdAt`, "The creation timestamp is required and cannot be inferred safely.");
          if (habit.type === "measurable") {
            if (typeof habit.unit !== "string" || !habit.unit.trim()) issue(errors, "INVALID_CUSTOM_HABIT_UNIT", `${path}.unit`, "Measurable habits require a non-empty unit.");
            if (typeof habit.goal === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(habit.goal.trim()) && Number.isFinite(Number(habit.goal))) {
              habit.goal = Number(habit.goal);
              warnings.push({ code: "NUMERIC_GOAL_NORMALIZED", path: `${path}.goal`, message: "A numeric string goal was converted using the existing storage normalizer's Number conversion." });
            }
            if (typeof habit.goal !== "number" || !Number.isFinite(habit.goal) || habit.goal <= 0) issue(errors, "INVALID_CUSTOM_HABIT_GOAL", `${path}.goal`, "Measurable habits require a finite positive goal.");
          } else if (habit.type === "boolean") {
            if (habit.goal != null) issue(errors, "INVALID_BOOLEAN_GOAL", `${path}.goal`, "Boolean habits cannot carry a goal.");
            if (habit.unit != null) issue(errors, "INVALID_BOOLEAN_UNIT", `${path}.unit`, "Boolean habits cannot carry a unit.");
          }
          if (habit.archived !== undefined && typeof habit.archived !== "boolean") issue(errors, "INVALID_ARCHIVED_VALUE", `${path}.archived`, "archived must be boolean.");
          if (habit.order !== undefined && (!Number.isInteger(habit.order) || habit.order < 0)) issue(errors, "INVALID_HABIT_ORDER", `${path}.order`, "order must be a non-negative integer.");
          for (const field of ["icon", "theme", "shortDescription"]) {
            if (habit[field] !== undefined && typeof habit[field] !== "string") issue(errors, "INVALID_HABIT_METADATA", `${path}.${field}`, `${field} must be a string.`);
          }
          for (const field of ["archived", "order", "icon", "theme", "shortDescription"]) {
            if (habit[field] === undefined) warnings.push({ code: "OPTIONAL_FIELD_DEFAULTED", path: `${path}.${field}`, message: `${field} will use the same safe default as the current storage normalizer.` });
          }
          warnings.push({ code: "CUSTOM_DEFINITION_HISTORY_UNAVAILABLE", path, message: "Local storage has no separate custom-habit definition history; the saved current definition will be represented as version 1 while dated snapshots remain authoritative for historical dates." });
        });
      }

      if (isRecord(data.entries)) {
        for (const [date, day] of Object.entries(data.entries)) {
          if (!isDate(date)) issue(errors, "INVALID_ENTRY_DATE", `entries.${date}`, "Daily entry keys must be valid YYYY-MM-DD dates.");
          if (!isRecord(day)) {
            issue(errors, "INVALID_DAY_ENTRIES", `entries.${date}`, "Daily entries must be an object keyed by ritual ID.");
            continue;
          }
          for (const [ritualId, entry] of Object.entries(day)) {
            const path = `entries.${date}.${ritualId}`;
            if (!isRecord(entry)) {
              issue(errors, "INVALID_ENTRY", path, "A daily ritual entry must be an object.");
              continue;
            }
            checkUnknownKeys(entry, ENTRY_KEYS, path, errors);
            for (const field of ["completed", "value", "completedAt"]) {
              if (entry[field] === undefined) warnings.push({ code: "ENTRY_FIELD_DEFAULTED", path: `${path}.${field}`, message: `Missing ${field} will receive the storage-compatible empty default.` });
            }
            if (ritualId === "sunscreen" && entry.applicationTimes === undefined) {
              warnings.push({ code: "APPLICATION_TIMES_DEFAULTED", path: `${path}.applicationTimes`, message: "Missing sunscreen history will be represented as an empty ordered list." });
            }
            if (entry.completed !== undefined && typeof entry.completed !== "boolean") issue(errors, "INVALID_COMPLETION", `${path}.completed`, "completed must be boolean.");
            if (entry.value !== undefined && entry.value !== null && !(typeof entry.value === "number" && Number.isFinite(entry.value))) {
              issue(errors, "INVALID_VALUE", `${path}.value`, "value must be a finite number or null; values are not coerced.");
            }
            if (entry.completedAt !== undefined && entry.completedAt !== null && !isTimestamp(entry.completedAt)) issue(errors, "INVALID_COMPLETION_TIMESTAMP", `${path}.completedAt`, "completedAt must be an ISO timestamp or null.");
            for (const [field, expectedRitual] of [["sleepTime", "sleep"], ["wakeTime", "wake"]]) {
              if (entry[field] !== undefined && entry[field] !== null && !isLocalTime(entry[field])) issue(errors, "INVALID_SLEEP_TIME", `${path}.${field}`, `${field} must be a valid local HH:mm time or null.`);
              if (entry[field] != null && ritualId !== expectedRitual) issue(errors, "SLEEP_TIME_WRONG_RITUAL", `${path}.${field}`, `${field} is only valid on the ${expectedRitual} ritual entry.`);
            }
            if (entry.applicationTimes !== undefined) {
              if (!Array.isArray(entry.applicationTimes)) issue(errors, "INVALID_APPLICATION_TIMES", `${path}.applicationTimes`, "applicationTimes must be an ordered array.");
              else entry.applicationTimes.forEach((timestamp, index) => {
                if (!isTimestamp(timestamp)) issue(errors, "INVALID_APPLICATION_TIMESTAMP", `${path}.applicationTimes[${index}]`, "Application time must be an ISO timestamp.");
              });
              if (ritualId !== "sunscreen") issue(errors, "APPLICATION_TIMES_WRONG_RITUAL", `${path}.applicationTimes`, "The cloud schema only stores applicationTimes for sunscreen.");
            }
            if (ritualId !== "tasks" && !Object.hasOwn(RITUAL_BY_ID, ritualId) && !customIds.has(ritualId)) {
              const snapshot = data.ritualSnapshots?.[date];
              if (!Array.isArray(snapshot) || !snapshot.some((definition) => definition?.id === ritualId)) {
                issue(errors, "UNKNOWN_RITUAL_ID", `${path}`, "No current custom habit, built-in ritual, or same-date snapshot identifies this ritual.");
              }
            }
            if (ritualId === "sleep-tracker" && (entry.completed === true || (entry.completedAt !== undefined && entry.completedAt !== null))) {
              issue(errors, "INFORMATIONAL_RITUAL_COMPLETION", path, "Sleep Tracker is informational and cannot migrate as a completed ritual.");
            }
          }
        }
      }

      if (isRecord(data.ritualSnapshots)) {
        for (const [date, snapshots] of Object.entries(data.ritualSnapshots)) {
          const path = `ritualSnapshots.${date}`;
          if (!isDate(date)) issue(errors, "INVALID_SNAPSHOT_DATE", path, "Snapshot keys must be valid YYYY-MM-DD dates.");
          if (!Array.isArray(snapshots)) {
            issue(errors, "INVALID_SNAPSHOT_LIST", path, "A date snapshot must be an array of ritual definitions.");
            continue;
          }
          const ids = new Set();
          snapshots.forEach((definition, index) => {
            if (!isRecord(definition)) {
              issue(errors, "INVALID_SNAPSHOT", `${path}[${index}]`, "A ritual snapshot must be an object.");
              return;
            }
            if (typeof definition.id !== "string" || !definition.id.trim()) issue(errors, "INVALID_SNAPSHOT_ID", `${path}[${index}].id`, "A snapshot requires its original ritual ID.");
            else if (ids.has(definition.id)) issue(errors, "DUPLICATE_SNAPSHOT_ID", `${path}[${index}].id`, "A date cannot contain duplicate ritual IDs.");
            else ids.add(definition.id);
          });
        }
      }

      if (isRecord(data.weeklyReflections)) {
        for (const [weekStart, reflection] of Object.entries(data.weeklyReflections)) {
          const path = `weeklyReflections.${weekStart}`;
          if (!isDate(weekStart)) issue(errors, "INVALID_WEEK_KEY", path, "Weekly reflection keys must be valid dates.");
          if (!isRecord(reflection)) issue(errors, "INVALID_WEEKLY_REFLECTION", path, "A weekly reflection must be an object.");
          else {
            checkUnknownKeys(reflection, WEEKLY_KEYS, path, errors);
            for (const field of WEEKLY_KEYS) {
              if (reflection[field] !== undefined && typeof reflection[field] !== "string") issue(errors, "INVALID_REFLECTION_TEXT", `${path}.${field}`, `${field} must be text.`);
              if (reflection[field] === undefined) warnings.push({ code: "REFLECTION_FIELD_DEFAULTED", path: `${path}.${field}`, message: `Missing ${field} will be represented as an empty string.` });
            }
          }
        }
      }

      if (isRecord(data.monthlyReflections)) {
        for (const [month, reflection] of Object.entries(data.monthlyReflections)) {
          const path = `monthlyReflections.${month}`;
          if (!isDate(month) || (isDate(month) && month.slice(-2) !== "01")) issue(errors, "INVALID_MONTH_KEY", path, "Monthly reflection keys must be first-of-month YYYY-MM-01 dates.");
          if (!isRecord(reflection)) issue(errors, "INVALID_MONTHLY_REFLECTION", path, "A monthly reflection must be an object.");
          else {
            checkUnknownKeys(reflection, MONTHLY_KEYS, path, errors);
            if (reflection.intention !== undefined && typeof reflection.intention !== "string") issue(errors, "INVALID_REFLECTION_TEXT", `${path}.intention`, "intention must be text.");
            if (reflection.intention === undefined) warnings.push({ code: "REFLECTION_FIELD_DEFAULTED", path: `${path}.intention`, message: "Missing intention will be represented as an empty string." });
          }
        }
      }
    }
  }

  const status = errors.length ? "invalid" : warnings.length ? "safely_normalizable" : "valid";
  return { status, data: isRecord(data) ? data : null, warnings, errors };
}

export const isIsoDate = isDate;
export const isIsoTimestamp = isTimestamp;
