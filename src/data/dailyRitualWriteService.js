import { getCurrentSession } from "../auth/authService.js";
import { cloudRepository } from "./cloud/cloudRepository.js";
import { repositoryResult } from "./repositories/repositoryContract.js";
import { isDateWithinArc } from "./storage.js";

const SAFE_FAILURE = {
  code: "DAILY_SAVE_FAILED",
  message: "Your change could not be saved to your account. Your last saved value has been restored.",
};

function failure(error) {
  if (error?.code === "CLOUD_CONFLICT") {
    return {
      code: "CONFLICT",
      message: "Newer progress was saved elsewhere. Loading the latest value; review it before changing it again.",
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
      message: "Couldn't save that change to your account. Your last saved progress is safe. Check your connection and retry.",
    };
  }
  return SAFE_FAILURE;
}

function normalizeSavedEntry(saved) {
  return {
    completed: Boolean(saved.completed),
    value: saved.value ?? null,
    completedAt: saved.completedAt ?? null,
    ...(saved.sleepTime != null ? { sleepTime: saved.sleepTime } : {}),
    ...(saved.wakeTime != null ? { wakeTime: saved.wakeTime } : {}),
    applicationTimes: Array.isArray(saved.applicationTimes) ? [...saved.applicationTimes] : [],
    ...(Number(saved.revision) > 0 ? { revision: Number(saved.revision) } : {}),
  };
}

/** Writes one already-merged entry for the exact account/program displayed by the UI. */
export async function saveDailyRitualEntry({
  expectedUserId,
  expectedProgramId,
  dateISO,
  arcStartDate,
  ritualId,
  entry,
  getSession = getCurrentSession,
  repository = cloudRepository,
} = {}) {
  if (!expectedUserId || !expectedProgramId || !dateISO || !ritualId || !entry) {
    return repositoryResult(null, { code: "DAILY_SAVE_FAILED", message: SAFE_FAILURE.message });
  }
  if (arcStartDate && !isDateWithinArc(arcStartDate, dateISO)) {
    return repositoryResult(null, {
      code: "ARC_COMPLETE",
      message: "This Winter Arc has ended. Your saved progress is still available in your history.",
    });
  }

  let auth;
  try {
    auth = await getSession();
  } catch {
    return repositoryResult(null, failure(null));
  }
  if (auth?.error || auth?.data?.user?.id !== expectedUserId) {
    return repositoryResult(null, failure({ code: "AUTHENTICATION_CHANGED" }));
  }

  let written;
  try {
    written = await repository.writeDailyEntry(dateISO, ritualId, entry, {
      userId: expectedUserId,
      programId: expectedProgramId,
    }, entry.revision ?? null);
  } catch {
    return repositoryResult(null, failure(null));
  }
  if (written?.error || !written?.data) {
    return repositoryResult(null, failure(written?.error));
  }

  let after;
  try {
    after = await getSession();
  } catch {
    return repositoryResult(null, failure({ code: "AUTHENTICATION_CHANGED" }));
  }
  if (after?.error || after?.data?.user?.id !== expectedUserId) {
    return repositoryResult(null, failure({ code: "AUTHENTICATION_CHANGED" }));
  }

  return repositoryResult(normalizeSavedEntry(written.data), null);
}
