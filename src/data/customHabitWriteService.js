import { getCurrentSession } from "../auth/authService.js";
import { customHabitToRitual, toISODate } from "./storage.js";
import { cloudRepository } from "./cloud/cloudRepository.js";
import { repositoryResult } from "./repositories/repositoryContract.js";

const SAVE_FAILED = {
  code: "CUSTOM_HABIT_SAVE_FAILED",
  message: "Couldn't save this custom habit to your account. Please retry; your local progress was not changed.",
};

function safeFailure(error) {
  if (error?.code === "CLOUD_CONFLICT") {
    return {
      code: "CONFLICT",
      message: "A newer habit definition exists in your account. Refresh your data before trying again.",
    };
  }
  if (error?.code === "AUTHENTICATION_REQUIRED" || error?.code === "AUTHENTICATION_CHANGED") {
    return {
      code: "AUTHENTICATION_CHANGED",
      message: "Your account changed while saving. Reload your account data and try again.",
    };
  }
  if (error?.code === "PROGRAM_NOT_FOUND") {
    return {
      code: "PROGRAM_CHANGED",
      message: "Your Winter Arc account changed while saving. Reload your account data and try again.",
    };
  }
  if (error?.code === "CLOUD_NETWORK_ERROR") {
    return {
      code: "NETWORK_UNAVAILABLE",
      message: "Couldn't reach your account to save this habit. Check your connection and retry.",
    };
  }
  return SAVE_FAILED;
}

function sessionMatches(result, expectedUserId) {
  return !result?.error && result?.data?.user?.id === expectedUserId;
}

/** Creates one stable custom-habit request across retries, scoped to displayed account/program. */
export async function saveCustomHabitToCloud({
  expectedUserId,
  expectedProgramId,
  habit,
  definitionId,
  ritualSnapshot,
  dateISO = toISODate(),
  getSession = getCurrentSession,
  repository = cloudRepository,
} = {}) {
  if (
    !expectedUserId || !expectedProgramId || !habit?.id || !habit.title
    || !definitionId || !Array.isArray(ritualSnapshot) || !dateISO
    || !["boolean", "measurable"].includes(habit.type)
  ) {
    return repositoryResult(null, SAVE_FAILED);
  }

  let auth;
  try {
    auth = await getSession();
  } catch {
    return repositoryResult(null, safeFailure({ code: "AUTHENTICATION_CHANGED" }));
  }
  if (!sessionMatches(auth, expectedUserId)) {
    return repositoryResult(null, safeFailure({ code: "AUTHENTICATION_CHANGED" }));
  }

  const owner = { userId: expectedUserId, programId: expectedProgramId };
  const definition = {
    id: definitionId,
    version: 1,
    effectiveFrom: habit.createdAt,
    title: habit.title,
    type: habit.type,
    unit: habit.type === "measurable" ? habit.unit : null,
    goal: habit.type === "measurable" ? habit.goal : null,
    icon: habit.icon,
    theme: habit.theme,
    shortDescription: habit.shortDescription,
    archived: habit.archived,
    order: habit.order,
  };
  try {
    const habitResult = await repository.writeCustomHabit(habit, owner);
    if (habitResult?.error || !habitResult?.data) {
      return repositoryResult(null, safeFailure(habitResult?.error));
    }

    const definitionResult = await repository.writeCustomHabitDefinition(habit.id, definition, owner);
    if (definitionResult?.error || !definitionResult?.data) {
      return repositoryResult(null, safeFailure(definitionResult?.error));
    }

    const confirmedHabit = {
      ...habitResult.data,
      title: definitionResult.data.title,
      type: definitionResult.data.type,
      unit: definitionResult.data.unit,
      goal: definitionResult.data.goal,
      icon: definitionResult.data.icon,
      theme: definitionResult.data.theme,
      shortDescription: definitionResult.data.shortDescription,
      archived: definitionResult.data.archived,
      order: definitionResult.data.order,
    };
    const confirmedRitual = customHabitToRitual(confirmedHabit);
    const confirmedSnapshot = [
      ...ritualSnapshot.filter((item) => item?.id !== habit.id),
      confirmedRitual,
    ];
    const snapshotResult = await repository.writeRitualSnapshots(dateISO, confirmedSnapshot, owner);
    if (snapshotResult?.error || !snapshotResult?.data) {
      return repositoryResult(null, safeFailure(snapshotResult?.error));
    }

    const after = await getSession();
    if (!sessionMatches(after, expectedUserId)) {
      return repositoryResult(null, safeFailure({ code: "AUTHENTICATION_CHANGED" }));
    }

    return repositoryResult({
      habit: confirmedHabit,
      definition: definitionResult.data,
      ritualSnapshot: confirmedSnapshot,
      dateISO,
    }, null);
  } catch {
    return repositoryResult(null, SAVE_FAILED);
  }
}

/** Archives a custom habit for the verified account without deleting its history. */
export async function archiveCustomHabitToCloud({
  expectedUserId,
  expectedProgramId,
  habit,
  getSession = getCurrentSession,
  repository = cloudRepository,
} = {}) {
  if (!expectedUserId || !expectedProgramId || !habit?.id || !Number.isInteger(Number(habit.revision))) {
    return repositoryResult(null, SAVE_FAILED);
  }
  let auth;
  try {
    auth = await getSession();
  } catch {
    return repositoryResult(null, safeFailure({ code: "AUTHENTICATION_CHANGED" }));
  }
  if (!sessionMatches(auth, expectedUserId)) {
    return repositoryResult(null, safeFailure({ code: "AUTHENTICATION_CHANGED" }));
  }
  try {
    const result = await repository.archiveCustomHabit(habit, {
      userId: expectedUserId,
      programId: expectedProgramId,
    });
    if (result?.error || !result?.data) {
      return repositoryResult(null, safeFailure(result?.error));
    }
    const after = await getSession();
    if (!sessionMatches(after, expectedUserId)) {
      return repositoryResult(null, safeFailure({ code: "AUTHENTICATION_CHANGED" }));
    }
    return repositoryResult(result.data, null);
  } catch {
    return repositoryResult(null, SAVE_FAILED);
  }
}

/** Adds a new effective definition revision without rewriting dated ritual snapshots. */
export async function updateCustomHabitInCloud({
  expectedUserId,
  expectedProgramId,
  habit,
  definitionId,
  changes,
  getSession = getCurrentSession,
  repository = cloudRepository,
} = {}) {
  if (!expectedUserId || !expectedProgramId || !habit?.id || !definitionId
    || !Number.isInteger(Number(habit.revision)) || !Number.isInteger(Number(habit.definitionRevision))) {
    return repositoryResult(null, SAVE_FAILED);
  }
  const title = typeof changes?.title === "string" ? changes.title.trim() : "";
  const type = changes?.type === "measurable" ? "measurable" : changes?.type === "boolean" ? "boolean" : null;
  const goal = type === "measurable" ? Number(changes?.goal) : null;
  const unit = type === "measurable" ? String(changes?.unit || "minutes").trim() || "minutes" : null;
  if (!title || !type || (type === "measurable" && (!Number.isFinite(goal) || goal <= 0))) {
    return repositoryResult(null, SAVE_FAILED);
  }
  let auth;
  try {
    auth = await getSession();
  } catch {
    return repositoryResult(null, safeFailure({ code: "AUTHENTICATION_CHANGED" }));
  }
  if (!sessionMatches(auth, expectedUserId)) {
    return repositoryResult(null, safeFailure({ code: "AUTHENTICATION_CHANGED" }));
  }
  const owner = { userId: expectedUserId, programId: expectedProgramId };
  const updated = {
    ...habit, title, type, unit, goal, archived: false,
  };
  try {
    const habitResult = await repository.writeCustomHabit(updated, owner);
    if (habitResult?.error || !habitResult?.data
      || Number(habitResult.data.revision) !== Number(habit.revision)) {
      return repositoryResult(null, safeFailure(habitResult?.error || { code: "CLOUD_CONFLICT" }));
    }
    const definitionResult = await repository.writeCustomHabitDefinition(habit.id, {
      id: definitionId,
      version: Number(habit.definitionRevision) + 1,
      effectiveFrom: new Date().toISOString(),
      title,
      type,
      unit,
      goal,
      icon: habit.icon,
      theme: habit.theme,
      shortDescription: habit.shortDescription,
      archived: false,
      order: habit.order,
    }, owner, Number(habit.definitionRevision));
    if (definitionResult?.error || !definitionResult?.data) {
      return repositoryResult(null, safeFailure(definitionResult?.error));
    }
    const after = await getSession();
    if (!sessionMatches(after, expectedUserId)) {
      return repositoryResult(null, safeFailure({ code: "AUTHENTICATION_CHANGED" }));
    }
    return repositoryResult({
      ...habitResult.data,
      ...updated,
      definitionRevision: Number(definitionResult.data.revision) || Number(habit.definitionRevision) + 1,
    }, null);
  } catch {
    return repositoryResult(null, SAVE_FAILED);
  }
}
