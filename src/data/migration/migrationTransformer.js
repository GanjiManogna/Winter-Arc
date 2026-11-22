import { RITUAL_BY_ID } from "../rituals.js";
import { isIsoDate, validateLocalData } from "./migrationValidation.js";

const MIGRATION_NAMESPACE = "winter-arc-local-migration-v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bytesToUuid(bytes) {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function deterministicUuid(scope, value) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is required to build stable migration identifiers.");
  const input = new TextEncoder().encode(`${MIGRATION_NAMESPACE}\0${scope}\0${value}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

function resolveDefinition(data, date, ritualId) {
  const dateSnapshots = data.ritualSnapshots?.[date];
  const historical = Array.isArray(dateSnapshots) ? dateSnapshots.find((item) => item?.id === ritualId) : null;
  if (historical) return historical;
  const habit = (Array.isArray(data.customHabits) ? data.customHabits : []).find((item) => item?.id === ritualId);
  if (habit) return habit;
  if (ritualId === "tasks") return { id: "tasks", type: "boolean" };
  return Object.hasOwn(RITUAL_BY_ID, ritualId) ? RITUAL_BY_ID[ritualId] : null;
}

function recordKind(ritualId, definition) {
  if (ritualId === "sleep-tracker") return "informational";
  return definition?.type === "measurable"
    || (Number.isFinite(definition?.goal) && definition.goal > 0)
    || (Number.isFinite(definition?.goalMin) && Number.isFinite(definition?.goalMax))
    ? "measurable"
    : "boolean";
}

function normalizeEntry(entry, ritualId) {
  return {
    completed: entry.completed ?? false,
    value: entry.value ?? null,
    completedAt: entry.completedAt ?? null,
    sleepTime: entry.sleepTime ?? null,
    wakeTime: entry.wakeTime ?? null,
    applicationTimes: entry.applicationTimes ?? (ritualId === "sunscreen" ? [] : []),
  };
}

function customHabitDefinition(habit, index) {
  const measurable = habit.type === "measurable";
  return {
    title: habit.title.trim(),
    habit_type: habit.type,
    unit: measurable ? habit.unit.trim() : null,
    goal: measurable ? habit.goal : null,
    icon: habit.icon ?? "✦",
    theme: habit.theme ?? "clarity",
    short_description: habit.shortDescription ?? "",
    archived: habit.archived ?? false,
    display_order: habit.order ?? index,
  };
}

export function summarizeLocalData(data) {
  const entriesByDate = data?.entries && typeof data.entries === "object" && !Array.isArray(data.entries) ? data.entries : {};
  const snapshots = data?.ritualSnapshots && typeof data.ritualSnapshots === "object" && !Array.isArray(data.ritualSnapshots) ? data.ritualSnapshots : {};
  const customHabits = Array.isArray(data?.customHabits) ? data.customHabits : [];
  const entries = Object.entries(entriesByDate).flatMap(([date, day]) =>
    day && typeof day === "object" && !Array.isArray(day)
      ? Object.entries(day).filter(([, entry]) => entry && typeof entry === "object" && !Array.isArray(entry))
        .map(([ritualId, entry]) => ({ date, ritualId, entry, kind: recordKind(ritualId, resolveDefinition({ ...data, customHabits, ritualSnapshots: snapshots }, date, ritualId)) }))
      : []
  );
  const customIds = new Set(customHabits.map((habit) => habit?.id).filter((id) => typeof id === "string"));
  for (const snapshot of Object.values(snapshots)) {
    if (!Array.isArray(snapshot)) continue;
    for (const definition of snapshot) {
      if (definition?.source === "custom" && typeof definition.id === "string") customIds.add(definition.id);
    }
  }
  return {
    sourceVersion: data?.version ?? null,
    arcStartDate: data?.startDate ?? null,
    recordedDays: new Set(entries.map(({ date }) => date)).size,
    dailyRitualRecords: entries.length,
    completedBooleanRituals: entries.filter(({ kind, entry }) => kind === "boolean" && entry.completed === true).length,
    measurableRecords: entries.filter(({ kind }) => kind === "measurable").length,
    sunscreenDaysWithApplicationTimes: entries.filter(({ ritualId, entry }) => ritualId === "sunscreen" && Array.isArray(entry.applicationTimes)).length,
    sunscreenDaysWithTimestamps: entries.filter(({ ritualId, entry }) => ritualId === "sunscreen" && Array.isArray(entry.applicationTimes) && entry.applicationTimes.length > 0).length,
    sunscreenApplicationTimestamps: entries
      .filter(({ ritualId }) => ritualId === "sunscreen")
      .reduce((count, { entry }) => count + (Array.isArray(entry.applicationTimes) ? entry.applicationTimes.length : 0), 0),
    sleepTrackerRecords: entries.filter(({ ritualId }) => ritualId === "sleep-tracker").length,
    sleepTrackerNonCompletionRecords: entries.filter(({ ritualId, entry }) => ritualId === "sleep-tracker" && entry.completed !== true && entry.completedAt == null).length,
    ritualSnapshots: Object.values(snapshots).reduce((count, list) => count + (Array.isArray(list) ? list.length : 0), 0),
    customHabits: customHabits.length,
    customHabitHistoricalRecords: entries.filter(({ ritualId }) => customIds.has(ritualId)).length,
    weeklyReflections: Object.keys(data?.weeklyReflections && typeof data.weeklyReflections === "object" && !Array.isArray(data.weeklyReflections) ? data.weeklyReflections : {}).length,
    monthlyReflections: Object.keys(data?.monthlyReflections && typeof data.monthlyReflections === "object" && !Array.isArray(data.monthlyReflections) ? data.monthlyReflections : {}).length,
  };
}

function sameSet(left, right) {
  const normalize = (items) => [...new Set(items)].sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function inspectMigrationPayload({ data, payload, repeatedPayload, userId }) {
  if (!data || !payload || !repeatedPayload) return null;
  const allRows = [
    payload.program,
    ...payload.customHabits,
    ...payload.customHabitDefinitions,
    ...payload.ritualSnapshots,
    ...payload.dailyRitualEntries,
    ...payload.weeklyReflections,
    ...payload.monthlyReflections,
  ];
  const dailySource = Object.entries(data.entries).flatMap(([date, day]) =>
    Object.keys(day).map((ritualId) => JSON.stringify([date, ritualId]))
  );
  const dailyTarget = payload.dailyRitualEntries.map((row) => JSON.stringify([row.entry_date, row.ritual_id]));
  const sourceEntryDates = Object.entries(data.entries).filter(([, day]) => Object.keys(day).length > 0).map(([date]) => date);
  const sourceSnapshotDates = Object.entries(data.ritualSnapshots).filter(([, definitions]) => definitions.length > 0).map(([date]) => date);
  const targetSnapshotDates = payload.ritualSnapshots.map((row) => row.snapshot_date);
  const snapshotsPreserved = Object.entries(data.ritualSnapshots).every(([date, definitions]) => {
    const target = payload.ritualSnapshots
      .filter((row) => row.snapshot_date === date)
      .sort((left, right) => left.position - right.position)
      .map((row) => row.definition);
    return JSON.stringify(definitions) === JSON.stringify(target);
  });
  const sunscreen = Object.entries(data.entries).flatMap(([date, day]) =>
    day.sunscreen && Object.hasOwn(day.sunscreen, "applicationTimes")
      ? [{ date, timestamps: day.sunscreen.applicationTimes }]
      : []
  );
  const sunscreenRows = new Map(payload.dailyRitualEntries
    .filter((row) => row.ritual_id === "sunscreen")
    .map((row) => [row.entry_date, row.application_times]));
  const sunscreenPreserved = sunscreen.every(({ date, timestamps }) =>
    JSON.stringify(timestamps) === JSON.stringify(sunscreenRows.get(date))
  );
  const sleepSource = Object.entries(data.entries).flatMap(([date, day]) =>
    day["sleep-tracker"] ? [{ date, entry: day["sleep-tracker"] }] : []
  );
  const sleepTarget = payload.dailyRitualEntries.filter((row) => row.ritual_id === "sleep-tracker");
  const sleepByDate = new Map(sleepTarget.map((row) => [row.entry_date, row]));
  const weeklyKeys = Object.keys(data.weeklyReflections);
  const monthlyKeys = Object.keys(data.monthlyReflections);
  const definitionsBySourceId = new Map(payload.customHabitDefinitions.map((row) => [
    payload.customHabits.find((habit) => habit.id === row.custom_habit_id)?.source_habit_id,
    row,
  ]));

  return {
    everyDestinationRecordHasAuthenticatedOwner: allRows.every((row) => row.user_id === userId),
    deterministicIdsStable: JSON.stringify(payload) === JSON.stringify(repeatedPayload),
    stableIdsUniqueWithinEachTable: [
      [payload.program], payload.customHabits, payload.customHabitDefinitions,
      payload.ritualSnapshots, payload.dailyRitualEntries,
      payload.weeklyReflections, payload.monthlyReflections,
    ].every((rows) => new Set(rows.map((row) => row.id)).size === rows.length),
    dailyRecordsAndDatesPreservedWithoutAddingRecords: sameSet(dailySource, dailyTarget)
      && sameSet(sourceEntryDates, payload.dailyRitualEntries.map((row) => row.entry_date)),
    ritualSnapshotsAndDatesPreservedWithoutAddingDates: snapshotsPreserved
      && sameSet(sourceSnapshotDates, targetSnapshotDates),
    sunscreenApplicationTimesRemainOrderedAndUnchanged: sunscreenPreserved,
    customHabitIdsAndDefinitionsPreserved: data.customHabits.length === payload.customHabits.length
      && data.customHabits.every((habit) => {
        const definition = definitionsBySourceId.get(habit.id);
        return payload.customHabits.some((row) => row.source_habit_id === habit.id)
          && definition?.title === habit.title.trim()
          && definition?.goal === (habit.type === "measurable" ? habit.goal : null);
      }),
    weeklyReflectionsPreservedWithoutAddingPeriods: sameSet(weeklyKeys, payload.weeklyReflections.map((row) => row.week_start))
      && payload.weeklyReflections.every((row) => {
        const source = data.weeklyReflections[row.week_start];
        return row.wins === (source.wins ?? "") && row.challenges === (source.challenges ?? "") && row.focus === (source.focus ?? "");
      }),
    monthlyReflectionsPreservedWithoutAddingPeriods: sameSet(monthlyKeys, payload.monthlyReflections.map((row) => row.month))
      && payload.monthlyReflections.every((row) => row.intention === (data.monthlyReflections[row.month].intention ?? "")),
    sleepTrackerRemainsInformationalAndValuesPreserved: sleepSource.length === sleepTarget.length
      && sleepSource.every(({ date, entry }) => {
        const row = sleepByDate.get(date);
        return row?.record_kind === "informational" && row.completed === false && row.completed_at === null && row.value === (entry.value ?? null);
      }),
  };
}

export async function buildMigrationPayload({ rawValue, userId } = {}) {
  const validation = validateLocalData(rawValue);
  if (!UUID_PATTERN.test(userId || "")) {
    validation.errors.push({ code: "AUTHENTICATED_USER_REQUIRED", path: "auth.user.id", message: "A valid authenticated Supabase user ID is required." });
    validation.status = "invalid";
    validation.data = null;
  }
  if (validation.errors.length) {
    return { status: "invalid", payload: null, validation, summary: null };
  }

  const data = validation.data;
  const programId = await deterministicUuid("program", userId);
  const customIdMap = new Map();
  for (const habit of data.customHabits) {
    customIdMap.set(habit.id, await deterministicUuid(`custom-habit:${programId}`, habit.id));
  }

  const program = {
    id: programId,
    user_id: userId,
    start_date: data.startDate,
    source_schema_version: data.version,
  };

  const customHabits = [];
  const customHabitDefinitions = [];
  data.customHabits.forEach((habit, index) => {
    const id = customIdMap.get(habit.id);
    customHabits.push({
      id,
      program_id: programId,
      user_id: userId,
      source_habit_id: habit.id,
      archived: habit.archived ?? false,
      display_order: habit.order ?? index,
      created_at: habit.createdAt,
    });
    customHabitDefinitions.push({
      id: null,
      custom_habit_id: id,
      program_id: programId,
      user_id: userId,
      version: 1,
      effective_from: habit.createdAt,
      ...customHabitDefinition(habit, index),
    });
  });
  for (let index = 0; index < customHabitDefinitions.length; index += 1) {
    const row = customHabitDefinitions[index];
    row.id = await deterministicUuid("custom-habit-definition", `${row.custom_habit_id}:1`);
  }

  const ritualSnapshots = [];
  for (const [date, definitions] of Object.entries(data.ritualSnapshots).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [position, definition] of definitions.entries()) {
      ritualSnapshots.push({
        id: await deterministicUuid("ritual-snapshot", `${programId}:${date}:${definition.id}`),
        program_id: programId,
        user_id: userId,
        snapshot_date: date,
        ritual_id: definition.id,
        custom_habit_id: customIdMap.get(definition.id) || null,
        position,
        definition,
      });
    }
  }

  const dailyRitualEntries = [];
  for (const [date, day] of Object.entries(data.entries).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [ritualId, sourceEntry] of Object.entries(day).sort(([a], [b]) => a.localeCompare(b))) {
      const entry = normalizeEntry(sourceEntry, ritualId);
      const kind = recordKind(ritualId, resolveDefinition(data, date, ritualId));
      dailyRitualEntries.push({
        id: await deterministicUuid("daily-entry", `${programId}:${date}:${ritualId}`),
        program_id: programId,
        user_id: userId,
        entry_date: date,
        ritual_id: ritualId,
        custom_habit_id: customIdMap.get(ritualId) || null,
        record_kind: kind,
        completed: kind === "informational" ? false : entry.completed,
        value: entry.value,
        completed_at: kind === "informational" ? null : entry.completedAt,
        sleep_time: entry.sleepTime,
        wake_time: entry.wakeTime,
        application_times: entry.applicationTimes,
      });
    }
  }

  const weeklyReflections = Object.entries(data.weeklyReflections)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, reflection]) => ({
      id: null,
      program_id: programId,
      user_id: userId,
      week_start: weekStart,
      wins: reflection.wins ?? "",
      challenges: reflection.challenges ?? "",
      focus: reflection.focus ?? "",
    }));
  for (const row of weeklyReflections) {
    row.id = await deterministicUuid("weekly-reflection", `${programId}:${row.week_start}`);
  }

  const monthlyReflections = Object.entries(data.monthlyReflections)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, reflection]) => ({
      id: null,
      program_id: programId,
      user_id: userId,
      month,
      intention: reflection.intention ?? "",
    }));
  for (const row of monthlyReflections) {
    row.id = await deterministicUuid("monthly-reflection", `${programId}:${row.month}`);
  }

  const payload = {
    program,
    customHabits,
    customHabitDefinitions,
    ritualSnapshots,
    dailyRitualEntries,
    weeklyReflections,
    monthlyReflections,
  };
  return {
    status: validation.status,
    payload,
    validation,
    summary: summarizeLocalData(data),
  };
}

export function validateArcDateForPayload(value) {
  return isIsoDate(value);
}
