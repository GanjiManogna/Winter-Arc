import { getCurrentSession } from "../auth/authService.js";
import { cloudRepository } from "./cloud/cloudRepository.js";
import { repositoryResult } from "./repositories/repositoryContract.js";

const SAVE_FAILED = {
  code: "REFLECTION_SAVE_FAILED",
  message: "Your reflection could not be saved to your account. Your last saved reflection is safe; please retry.",
};

function safeFailure(error) {
  if (error?.code === "CLOUD_CONFLICT") {
    return { code: "CONFLICT", message: "A newer reflection was saved elsewhere. The latest value has been loaded; review it before editing again." };
  }
  if (error?.code === "AUTHENTICATION_REQUIRED" || error?.code === "AUTHENTICATION_CHANGED") {
    return { code: "AUTHENTICATION_CHANGED", message: "Your account changed while saving. Reload your account data and try again." };
  }
  if (error?.code === "PROGRAM_NOT_FOUND") {
    return { code: "PROGRAM_CHANGED", message: "Your Winter Arc account changed while saving. Reload your account data and try again." };
  }
  if (error?.code === "CLOUD_NETWORK_ERROR") {
    return { code: "NETWORK_UNAVAILABLE", message: "Couldn't reach your account to save this reflection. Check your connection and retry." };
  }
  return SAVE_FAILED;
}

function matchesSession(result, userId) {
  return !result?.error && result?.data?.user?.id === userId;
}

async function writeReflection({ expectedUserId, expectedProgramId, key, value, expectedRevision, writer, getSession, repository }) {
  if (!expectedUserId || !expectedProgramId || !key || !value || typeof value !== "object") {
    return repositoryResult(null, SAVE_FAILED);
  }
  try {
    const before = await getSession();
    if (!matchesSession(before, expectedUserId)) return repositoryResult(null, safeFailure({ code: "AUTHENTICATION_CHANGED" }));
    const result = await writer(repository, key, value, { userId: expectedUserId, programId: expectedProgramId }, expectedRevision);
    if (result?.error || !result?.data) return repositoryResult(null, safeFailure(result?.error));
    const after = await getSession();
    if (!matchesSession(after, expectedUserId)) return repositoryResult(null, safeFailure({ code: "AUTHENTICATION_CHANGED" }));
    return repositoryResult(result.data, null);
  } catch (error) {
    return repositoryResult(null, safeFailure(error));
  }
}

export function saveWeeklyReflectionToCloud({
  expectedUserId, expectedProgramId, weekStart, reflection, expectedRevision = null,
  getSession = getCurrentSession, repository = cloudRepository,
} = {}) {
  if (!reflection || typeof reflection.wins !== "string" || typeof reflection.challenges !== "string" || typeof reflection.focus !== "string") {
    return Promise.resolve(repositoryResult(null, SAVE_FAILED));
  }
  return writeReflection({
    expectedUserId, expectedProgramId, key: weekStart, value: reflection, expectedRevision, getSession, repository,
    writer: (repo, key, value, owner, revision) => repo.writeWeeklyReflection(key, value, owner, revision),
  });
}

export function saveMonthlyReflectionToCloud({
  expectedUserId, expectedProgramId, month, intention, expectedRevision = null,
  getSession = getCurrentSession, repository = cloudRepository,
} = {}) {
  if (typeof intention !== "string") return Promise.resolve(repositoryResult(null, SAVE_FAILED));
  return writeReflection({
    expectedUserId, expectedProgramId, key: month, value: { intention }, expectedRevision, getSession, repository,
    writer: (repo, key, value, owner, revision) => repo.writeMonthlyReflection(key, value, owner, revision),
  });
}
