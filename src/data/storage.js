import { RITUAL_BY_ID, RITUALS } from "./rituals.js";
import { calculateSleepDuration, isLocalTime } from "./sleepDuration.js";
import { deriveCompleted, getRitualStatus, isInformationalRitual, isMeasurableRitual, toNumericValue } from "./ritualStatus.js";

export const PROGRESS_STORAGE_KEY = "winterArc.progress.v1";
export const ARC_DURATION_DAYS = 92;

let progressAccountScope = null;

/** Scope fallback progress to the authenticated account without adopting ambiguous legacy data. */
export function setProgressAccountScope(userId = null) {
  progressAccountScope = typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

export function getProgressStorageKeyForAccount(userId = progressAccountScope) {
  return typeof userId === "string" && userId.trim()
    ? `${PROGRESS_STORAGE_KEY}.account.${userId.trim()}`
    : PROGRESS_STORAGE_KEY;
}

/* Shape is backend-ready:
   {
     version,
     startDate,
     entries: { [isoDate]: { [ritualId]: { completed, value, completedAt, applicationTimes? } } },
     customHabits: [{ id, title, type, unit, goal, icon, theme, createdAt, archived, order }],
     ritualSnapshots: { [isoDate]: [ritual definitions active on that date] },
     weeklyReflections: { [weekStartIso]: { wins, challenges, focus } }
     monthlyReflections: { [monthIso]: { intention } }
   }
*/

function pad(value) {
  return String(value).padStart(2, "0");
}

export function toISODate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISODate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(iso, amount) {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + amount);
  return toISODate(date);
}

export function getCalendarDayDifference(fromISO, toISO) {
  const toOrdinal = (iso) => {
    const [year, month, day] = iso.split("-").map(Number);
    return Date.UTC(year, month - 1, day) / 86400000;
  };
  return toOrdinal(toISO) - toOrdinal(fromISO);
}

export function getArcEndDate(startDate) {
  return addDays(startDate, ARC_DURATION_DAYS - 1);
}

export function getArcEndDateFromProgress(progress) {
  return progress?.startDate ? getArcEndDate(progress.startDate) : null;
}

export function isDateWithinArc(startDateOrProgress, dateISO) {
  const startDate = typeof startDateOrProgress === "string"
    ? startDateOrProgress
    : startDateOrProgress?.startDate;
  if (!startDate || typeof dateISO !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return false;
  return dateISO >= startDate && dateISO <= getArcEndDate(startDate);
}

export function clampDateToArc(startDateOrProgress, dateISO) {
  const startDate = typeof startDateOrProgress === "string"
    ? startDateOrProgress
    : startDateOrProgress?.startDate;
  if (!startDate) return dateISO;
  return dateISO < startDate ? startDate : dateISO > getArcEndDate(startDate) ? getArcEndDate(startDate) : dateISO;
}

function withSleepTrackerLast(rituals) {
  const sleepTracker = rituals.find((ritual) => ritual.id === "sleep-tracker");
  return [...rituals.filter((ritual) => ritual.id !== "sleep-tracker"), ...(sleepTracker ? [sleepTracker] : [])];
}

function emptyState() {
  return {
    version: 1,
    startDate: toISODate(),
    entries: {},
    customHabits: [],
    ritualSnapshots: {},
    weeklyReflections: {},
    monthlyReflections: {},
  };
}

function normalizeCustomHabit(habit, index = 0) {
  if (!habit || typeof habit !== "object" || !habit.id || !habit.title) {
    return null;
  }

  const type = habit.type === "measurable" ? "measurable" : "boolean";
  const goal = Number(habit.goal);

  return {
    id: String(habit.id),
    title: String(habit.title).trim(),
    type,
    unit: type === "measurable" ? String(habit.unit || "minutes").trim() || "minutes" : null,
    goal: type === "measurable" && Number.isFinite(goal) && goal > 0 ? goal : null,
    icon: habit.icon || "✦",
    theme: habit.theme || "clarity",
    shortDescription: habit.shortDescription || "",
    createdAt: habit.createdAt || new Date().toISOString(),
    archived: Boolean(habit.archived),
    order: Number.isFinite(habit.order) ? habit.order : index,
  };
}

export function customHabitToRitual(habit) {
  const measurable = habit.type === "measurable" && Number.isFinite(habit.goal) && habit.goal > 0;
  const unit = measurable ? habit.unit : null;

  return {
    id: habit.id,
    route: `/ritual/${habit.id}`,
    title: habit.title,
    shortDescription:
      habit.shortDescription ||
      (measurable ? `Aim for ${habit.goal} ${unit}.` : "A promise you chose."),
    inspirationalLine: "A habit you named.\nA path you keep.",
    icon: habit.icon || "✦",
    theme: habit.theme || "clarity",
    colors: {
      glow: "rgba(214, 154, 72, 0.32)",
      accent: "#c4893a",
      muted: "#8a7458",
    },
    inspiration: "A custom Winter Arc habit.",
    deityInspiration: "Clarity you chose for yourself.",
    unit,
    goal: measurable ? habit.goal : null,
    actionLabel: measurable ? "Today's Progress" : "Today's presence",
    source: "custom",
    createdAt: habit.createdAt,
    archived: habit.archived,
    order: habit.order,
  };
}

export function loadProgress() {
  try {
    const raw = localStorage.getItem(getProgressStorageKeyForAccount());
    if (!raw) {
      const initial = emptyState();
      localStorage.setItem(getProgressStorageKeyForAccount(), JSON.stringify(initial));
      return initial;
    }

    const parsed = JSON.parse(raw);
    const habits = Array.isArray(parsed.customHabits) ? parsed.customHabits : [];

    return {
      version: 1,
      startDate: parsed.startDate || toISODate(),
      entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {},
      customHabits: habits.map(normalizeCustomHabit).filter(Boolean),
      ritualSnapshots:
        parsed.ritualSnapshots && typeof parsed.ritualSnapshots === "object"
          ? parsed.ritualSnapshots
          : {},
      weeklyReflections:
        parsed.weeklyReflections && typeof parsed.weeklyReflections === "object"
          ? parsed.weeklyReflections
          : {},
      monthlyReflections:
        parsed.monthlyReflections && typeof parsed.monthlyReflections === "object"
          ? parsed.monthlyReflections
          : {},
    };
  } catch {
    return emptyState();
  }
}

export function saveProgress(data) {
  localStorage.setItem(getProgressStorageKeyForAccount(), JSON.stringify(data));
  window.dispatchEvent(new Event("winter-arc-progress"));
}

export function getArcDayNumber(date = new Date()) {
  return getArcDayNumberFromProgress(loadProgress(), date);
}

export function getArcDayNumberFromProgress(progress, date = new Date()) {
  const { startDate } = progress;
  return getCalendarDayDifference(startDate, toISODate(date)) + 1;
}

export function getDayNumber(date = new Date()) {
  return Math.min(ARC_DURATION_DAYS, Math.max(1, getArcDayNumber(date)));
}

export function getDayNumberFromProgress(progress, date = new Date()) {
  return Math.min(ARC_DURATION_DAYS, Math.max(1, getArcDayNumberFromProgress(progress, date)));
}

export function getEntry(ritualId, dateISO = toISODate()) {
  const progress = loadProgress();
  if (!isDateWithinArc(progress, dateISO)) return null;
  return progress.entries[dateISO]?.[ritualId] || null;
}

export function getTodayEntries(dateISO = toISODate()) {
  const progress = loadProgress();
  if (!isDateWithinArc(progress, dateISO)) return {};
  return withCalculatedSleepDuration(progress, dateISO);
}

/** Adds a derived informational duration without changing persisted entries. */
export function withCalculatedSleepDuration(progress, dateISO) {
  const entries = progress?.entries?.[dateISO] || {};
  const summary = getSleepSummaryFromProgress(progress, dateISO);
  if (summary.durationMinutes === null) return entries;
  return {
    ...entries,
    "sleep-tracker": {
      ...(entries["sleep-tracker"] || { completed: false, completedAt: null }),
      value: summary.durationHours,
      calculatedDurationMinutes: summary.durationMinutes,
    },
  };
}

/** Returns account-provided bedtime/wake times and derived duration without mutating progress. */
export function getSleepSummaryFromProgress(progress, dateISO) {
  const currentEntries = progress?.entries?.[dateISO] || {};
  const previousEntries = progress?.entries?.[addDays(dateISO, -1)] || {};
  const rawSleepTime = previousEntries.sleep?.completed ? previousEntries.sleep.sleepTime : null;
  const rawWakeTime = currentEntries.wake?.completed ? currentEntries.wake.wakeTime : null;
  const sleepTime = isLocalTime(rawSleepTime) ? rawSleepTime : null;
  const wakeTime = isLocalTime(rawWakeTime) ? rawWakeTime : null;
  const duration = sleepTime && wakeTime ? calculateSleepDuration(sleepTime, wakeTime) : null;
  const manualValue = Number(currentEntries["sleep-tracker"]?.value);

  return {
    sleepTime,
    wakeTime,
    durationMinutes: duration?.durationMinutes ?? null,
    durationHours: duration?.durationHours ?? null,
    manualHours: Number.isFinite(manualValue) && manualValue > 0 ? manualValue : null,
  };
}

export function getCustomHabits() {
  return loadProgress().customHabits || [];
}

export function getAllRituals() {
  const customs = getCustomHabits()
    .filter((habit) => !habit.archived)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(customHabitToRitual);

  return withSleepTrackerLast([...RITUALS, ...customs]);
}

function createdOnOrBefore(habit, dateISO) {
  const created = habit.createdAt ? new Date(habit.createdAt) : null;
  if (!created || Number.isNaN(created.getTime())) return true;
  return toISODate(created) <= dateISO;
}

export function getRitualsForDate(dateISO) {
  return getRitualsForDateFromProgress(loadProgress(), dateISO);
}

export function getRitualsForDateFromProgress(data, dateISO) {
  if (!isDateWithinArc(data, dateISO)) return [];
  const savedSnapshot = data.ritualSnapshots?.[dateISO];
  if (Array.isArray(savedSnapshot)) {
    return savedSnapshot;
  }

  const day = data.entries[dateISO] || {};
  const customs = data.customHabits
    .filter((habit) => createdOnOrBefore(habit, dateISO) || Boolean(day[habit.id]))
    .filter((habit) => !habit.archived || Boolean(day[habit.id]))
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(customHabitToRitual);
  const legacyTasks = day.tasks && !customs.some((habit) => habit.id === "tasks")
    ? [{
        id: "tasks",
        route: "/ritual/tasks",
        title: "Complete Your Tasks",
        shortDescription: "Do what matters today.",
        icon: "◇",
        theme: "clarity",
        unit: null,
        goal: null,
        actionLabel: "Today's presence",
      }]
    : [];
  const dateRituals = RITUALS.filter(
    (ritual) => !ritual.introducedOn || ritual.introducedOn <= dateISO
  );
  return withSleepTrackerLast([...dateRituals, ...customs, ...legacyTasks]);
}

export function getRitualById(ritualId) {
  if (RITUAL_BY_ID[ritualId]) {
    return RITUAL_BY_ID[ritualId];
  }

  const habit = getCustomHabits().find((item) => item.id === ritualId && !item.archived);
  return habit ? customHabitToRitual(habit) : null;
}

export function getRitualByIdFromProgress(ritualId, progress) {
  if (RITUAL_BY_ID[ritualId]) return RITUAL_BY_ID[ritualId];
  const habit = (progress.customHabits || []).find((item) => item.id === ritualId && !item.archived);
  return habit ? customHabitToRitual(habit) : null;
}

/** Build one normalized custom-habit record without persisting it. */
export function createCustomHabitRecord({ id, title, type, unit, goal, createdAt, archived = false, order = 0 } = {}) {
  const trimmed = String(title || "").trim();
  if (!id || !trimmed) return null;
  const measurable = type === "measurable";
  const parsedGoal = Number(goal);
  if (measurable && (!Number.isFinite(parsedGoal) || parsedGoal <= 0)) return null;

  return normalizeCustomHabit({
    id: String(id),
    title: trimmed,
    type: measurable ? "measurable" : "boolean",
    unit: measurable ? unit : null,
    goal: measurable ? parsedGoal : null,
    createdAt: createdAt || new Date().toISOString(),
    archived: Boolean(archived),
    order: Number.isFinite(order) ? order : 0,
  }, order);
}

export function createCustomHabit({ title, type, unit, goal }) {
  const trimmed = String(title || "").trim();
  if (!trimmed) {
    return null;
  }

  const data = loadProgress();
  if (!isDateWithinArc(data, toISODate())) return null;
  const habits = data.customHabits || [];
  const habit = createCustomHabitRecord({
    id: `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: trimmed,
    type,
    unit,
    goal,
    createdAt: new Date().toISOString(),
    archived: false,
    order: habits.length,
  });

  data.customHabits = [...habits, habit];
  const today = toISODate();
  if (data.ritualSnapshots?.[today]) {
    const currentRituals = getAllRituals();
    const sleepTracker = currentRituals.find((ritual) => ritual.id === "sleep-tracker");
    data.ritualSnapshots[today] = [
      ...currentRituals.filter((ritual) => ritual.id !== "sleep-tracker"),
      customHabitToRitual(habit),
      ...(sleepTracker ? [sleepTracker] : []),
    ];
  }
  saveProgress(data);
  return customHabitToRitual(habit);
}

/** Archive an active local custom habit while retaining entries and dated snapshots. */
export function archiveCustomHabit(ritualId) {
  const data = loadProgress();
  const habit = data.customHabits.find((item) => item.id === ritualId && !item.archived);
  if (!habit) return null;
  const archivedHabit = { ...habit, archived: true };
  data.customHabits = data.customHabits.map((item) => item.id === ritualId ? archivedHabit : item);
  saveProgress(data);
  return customHabitToRitual(archivedHabit);
}

/** Edit the active local definition; saved day snapshots remain unchanged. */
export function updateCustomHabitDefinition(ritualId, changes = {}) {
  const data = loadProgress();
  const current = data.customHabits.find((item) => item.id === ritualId && !item.archived);
  if (!current) return null;
  const title = typeof changes.title === "string" ? changes.title.trim() : current.title;
  const type = changes.type === "measurable" ? "measurable" : changes.type === "boolean" ? "boolean" : current.type;
  const goal = type === "measurable" ? Number(changes.goal ?? current.goal) : null;
  if (!title || (type === "measurable" && (!Number.isFinite(goal) || goal <= 0))) return null;
  const unit = type === "measurable"
    ? String(changes.unit ?? current.unit ?? "minutes").trim()
    : null;
  const updated = normalizeCustomHabit({
    ...current,
    title,
    type,
    goal,
    unit,
  });
  data.customHabits = data.customHabits.map((habit) => habit.id === ritualId ? updated : habit);
  saveProgress(data);
  return updated;
}

export function getTodayCompletedIds(dateISO = toISODate()) {
  const day = getTodayEntries(dateISO);
  return getAllRituals()
    .filter((ritual) => !isInformationalRitual(ritual) && getRitualStatus(ritual, day[ritual.id]).completed)
    .map((ritual) => ritual.id);
}

export function upsertRitualEntry(ritualId, patch, dateISO = toISODate()) {
  const data = loadProgress();
  if (!isDateWithinArc(data, dateISO)) return null;
  data.ritualSnapshots = { ...(data.ritualSnapshots || {}) };
  if (!data.ritualSnapshots[dateISO]) {
    data.ritualSnapshots[dateISO] = getAllRituals();
  } else if (
    (ritualId === "sunscreen" || ritualId === "skincare") &&
    Array.isArray(data.ritualSnapshots[dateISO]) &&
    !data.ritualSnapshots[dateISO].some((ritual) => ritual.id === ritualId)
  ) {
    const snapshot = [...data.ritualSnapshots[dateISO]];
    const ritualOrder = RITUALS.findIndex((ritual) => ritual.id === ritualId);
    const nextRitualIndex = snapshot.findIndex((ritual) => {
      const savedOrder = RITUALS.findIndex((candidate) => candidate.id === ritual.id);
      return (savedOrder > ritualOrder) || ritual.source === "custom";
    });
    snapshot.splice(nextRitualIndex < 0 ? snapshot.length : nextRitualIndex, 0, RITUAL_BY_ID[ritualId]);
    data.ritualSnapshots[dateISO] = snapshot;
  }
  const day = { ...(data.entries[dateISO] || {}) };
  const current = day[ritualId] || {
    completed: false,
    value: null,
    completedAt: null,
  };
  const ritual = getRitualById(ritualId);

  const merged = mergeRitualEntry(ritual, current, patch);

  day[ritualId] = merged;
  data.entries[dateISO] = day;
  saveProgress(data);
  return day[ritualId];
}

/** Pure shared entry merge used by both local storage and cloud writes. */
export function mergeRitualEntry(ritual, current = null, patch = {}) {
  const merged = {
    completed: false,
    value: null,
    completedAt: null,
    ...(current || {}),
    ...patch,
  };

  if (ritual?.id === "sunscreen" || ritual?.id === "food") {
    const status = getRitualStatus(ritual, merged);
    merged.completed = status.completed;
    merged.completedAt = status.completed
      ? merged.completedAt || new Date().toISOString()
      : null;
  } else if (ritual && isMeasurableRitual(ritual)) {
    const completed = deriveCompleted(ritual, merged);
    merged.completed = completed;
    merged.completedAt = completed
      ? merged.completedAt || new Date().toISOString()
      : null;
  }

  return merged;
}

export function setRitualComplete(ritualId, completed, value = null, dateISO = toISODate()) {
  return upsertRitualEntry(
    ritualId,
    {
      completed,
      value,
      completedAt: completed ? new Date().toISOString() : null,
    },
    dateISO
  );
}

export function getRitualHistory(ritualId, days = 7, dateISO = toISODate()) {
  return getRitualHistoryFromProgress(loadProgress(), ritualId, days, dateISO);
}

export function getRitualHistoryFromProgress(progress, ritualId, days = 7, dateISO = toISODate()) {
  const { entries } = progress;
  const history = [];
  const boundedDate = clampDateToArc(progress, dateISO);

  for (let i = 0; i < days; i += 1) {
    const iso = addDays(boundedDate, -i);
    if (!isDateWithinArc(progress, iso)) break;
    const entry = ritualId === "sleep-tracker"
      ? withCalculatedSleepDuration(progress, iso)[ritualId]
      : entries[iso]?.[ritualId];
    const ritual = getRitualByIdFromProgress(ritualId, progress);
    const status = getRitualStatus(ritual, entry);
    history.push({
      date: iso,
      completed: status.completed,
      inProgress: status.inProgress,
      mark: status.mark,
      rangeState: status.rangeState || null,
      value: entry?.value ?? null,
    });
  }

  return history;
}

export function getRitualStats(ritualId, dateISO = toISODate()) {
  return getRitualStatsFromProgress(loadProgress(), ritualId, dateISO);
}

export function getRitualStatsFromProgress(progress, ritualId, dateISO = toISODate()) {
  const { entries } = progress;
  let streak = 0;
  let cursor = clampDateToArc(progress, dateISO);

  const ritual = getRitualByIdFromProgress(ritualId, progress);
  while (
    isDateWithinArc(progress, cursor) && (isInformationalRitual(ritual)
      ? toNumericValue(withCalculatedSleepDuration(progress, cursor)[ritualId]?.value) > 0
      : getRitualStatus(ritual, entries[cursor]?.[ritualId]).completed)
  ) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  const weekStartIso = getArcWeekStartIsoFromProgress(progress, dateISO);

  let completedThisWeek = 0;
  let elapsedDays = 0;
  for (let i = 0; i < 7; i += 1) {
    const iso = addDays(weekStartIso, i);
    if (iso > toISODate() || !isDateWithinArc(progress, iso)) continue;
    elapsedDays += 1;
    const entry = ritualId === "sleep-tracker"
      ? withCalculatedSleepDuration(progress, iso)[ritualId]
      : entries[iso]?.[ritualId];
    const status = getRitualStatus(ritual, entry);
    if (isInformationalRitual(ritual) ? toNumericValue(status.value) > 0 : status.completed) {
      completedThisWeek += 1;
    }
  }

  return {
    streak,
    completedThisWeek,
    weekTotal: elapsedDays,
  };
}

export function getArcWeekStartIso(iso = toISODate()) {
  return getArcWeekStartIsoFromProgress(loadProgress(), iso);
}

export function getArcWeekStartIsoFromProgress(progress, iso = toISODate()) {
  const { startDate } = progress;
  const boundedIso = clampDateToArc(progress, iso);
  const diff = getCalendarDayDifference(startDate, boundedIso);
  return addDays(startDate, Math.max(0, Math.floor(diff / 7)) * 7);
}

function dayHasRecordedActivity(day) {
  if (!day || typeof day !== "object") {
    return false;
  }

  return Object.values(day).some((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    if (entry.completed) {
      return true;
    }
    if (Array.isArray(entry.applicationTimes)
      && entry.applicationTimes.some((timestamp) => typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp)))) {
      return true;
    }
    const numeric = Number(entry.value);
    return Number.isFinite(numeric) && numeric > 0;
  });
}

export function getRecordedDates() {
  return getRecordedDatesFromProgress(loadProgress());
}

export function getRecordedDatesFromProgress(progress) {
  const { entries } = progress;
  return Object.keys(entries)
    .filter((iso) => isDateWithinArc(progress, iso) && dayHasRecordedActivity(entries[iso]))
    .sort((a, b) => b.localeCompare(a));
}

export function getHistoryOverview() {
  return getHistoryOverviewFromProgress(loadProgress());
}

export function getHistoryOverviewFromProgress(progress, date = new Date()) {
  const dates = getRecordedDatesFromProgress(progress);
  const daysWithCompletion = dates.filter((iso) => {
    return getDaySnapshotFromProgress(progress, iso).completedCount > 0;
  }).length;

  return {
    currentDay: getDayNumberFromProgress(progress, date),
    recordedDays: dates.length,
    daysWithCompletion,
  };
}

export function getDaySnapshot(dateISO) {
  return getDaySnapshotFromProgress(loadProgress(), dateISO);
}

export function getDaySnapshotFromProgress(progress, dateISO) {
  if (!isDateWithinArc(progress, dateISO)) {
    return { iso: dateISO, dayNumber: getDayNumberFromProgress(progress, parseISODate(dateISO)), completedCount: 0, total: 0, rows: [] };
  }
  const rituals = getRitualsForDateFromProgress(progress, dateISO);
  const day = withCalculatedSleepDuration(progress, dateISO);
  const rows = rituals.map((ritual) => {
    const entry = day[ritual.id] || null;
    return {
      ritual,
      entry,
      status: getRitualStatus(ritual, entry),
    };
  });

  return {
    iso: dateISO,
    dayNumber: getDayNumberFromProgress(progress, parseISODate(dateISO)),
    completedCount: rows.filter((row) => !isInformationalRitual(row.ritual) && row.status.completed).length,
    total: rows.filter((row) => !isInformationalRitual(row.ritual)).length,
    rows,
  };
}

export function getWeeklyReflection(weekStartIso) {
  return getWeeklyReflectionFromProgress(loadProgress(), weekStartIso);
}

export function getWeeklyReflectionFromProgress(progress, weekStartIso) {
  const notes = progress.weeklyReflections?.[weekStartIso] || {};
  return {
    wins: typeof notes.wins === "string" ? notes.wins : "",
    challenges: typeof notes.challenges === "string" ? notes.challenges : "",
    focus: typeof notes.focus === "string" ? notes.focus : "",
  };
}

export function saveWeeklyReflection(weekStartIso, patch) {
  const data = loadProgress();
  const current = getWeeklyReflection(weekStartIso);
  data.weeklyReflections = { ...(data.weeklyReflections || {}) };
  data.weeklyReflections[weekStartIso] = {
    ...current,
    ...patch,
  };
  saveProgress(data);
  return data.weeklyReflections[weekStartIso];
}

export function getMonthlyIntention(monthIso) {
  return getMonthlyIntentionFromProgress(loadProgress(), monthIso);
}

export function getMonthlyIntentionFromProgress(progress, monthIso) {
  const intention = progress.monthlyReflections?.[monthIso]?.intention;
  return typeof intention === "string" ? intention : "";
}

export function saveMonthlyIntention(monthIso, intention) {
  const data = loadProgress();
  data.monthlyReflections = { ...(data.monthlyReflections || {}) };
  data.monthlyReflections[monthIso] = {
    ...(data.monthlyReflections[monthIso] || {}),
    intention: String(intention ?? ""),
  };
  saveProgress(data);
  return data.monthlyReflections[monthIso];
}
