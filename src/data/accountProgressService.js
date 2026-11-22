import { getCurrentSession } from "../auth/authService.js";
import { cloudRepository } from "./cloud/cloudRepository.js";

export const ACCOUNT_PROGRESS_STATES = Object.freeze([
  "loading",
  "unauthenticated",
  "no-cloud-program",
  "loaded",
  "cloud-load-error",
]);

export const INITIAL_ACCOUNT_PROGRESS_STATE = Object.freeze({
  status: "loading",
  progress: null,
  error: null,
});

function emit(onStateChange, state) {
  try {
    onStateChange?.(state);
  } catch {
    // State observers cannot interrupt a data load.
  }
}

function result(status, progress = null, error = null) {
  return { status, progress, error };
}

function safeError(error) {
  const known = new Set([
    "AUTHENTICATION_REQUIRED", "AUTH_UNAVAILABLE", "PROGRAM_NOT_FOUND",
    "AUTHENTICATION_CHANGED", "CLOUD_UNAVAILABLE", "CLOUD_REQUEST_FAILED", "CLOUD_DATA_INVALID",
    "CLOUD_NETWORK_ERROR",
  ]);
  const code = known.has(error?.code) ? error.code : "CLOUD_LOAD_FAILED";
  return {
    code,
    message: code === "CLOUD_DATA_INVALID"
      ? "Cloud Winter Arc data is incomplete or malformed and could not be loaded safely."
      : code === "CLOUD_NETWORK_ERROR"
        ? "The cloud connection is unavailable. Please try again."
        : "Winter Arc data could not be loaded from the cloud. Please try again.",
  };
}

/** Load the signed-in account's cloud model without accepting a caller-selected owner. */
export async function loadAccountProgress({
  getSession = getCurrentSession,
  repository = cloudRepository,
  onStateChange,
  expectedUserId = null,
} = {}) {
  emit(onStateChange, INITIAL_ACCOUNT_PROGRESS_STATE);
  let auth;
  try {
    auth = await getSession();
  } catch {
    const failed = result("cloud-load-error", null, safeError({ code: "AUTH_ERROR" }));
    emit(onStateChange, failed);
    return failed;
  }
  if (auth?.error) {
    const failed = result("cloud-load-error", null, safeError(auth.error));
    emit(onStateChange, failed);
    return failed;
  }
  if (!auth?.data?.user) {
    const unauthenticated = result("unauthenticated");
    emit(onStateChange, unauthenticated);
    return unauthenticated;
  }
  if (expectedUserId && auth.data.user.id !== expectedUserId) {
    const failed = result("cloud-load-error", null, {
      code: "AUTHENTICATION_CHANGED",
      message: "The signed-in account changed while Winter Arc data was loading. Please try again.",
    });
    emit(onStateChange, failed);
    return failed;
  }

  let loaded;
  try {
    loaded = await repository.loadProgress();
  } catch {
    const failed = result("cloud-load-error", null, safeError({ code: "CLOUD_LOAD_FAILED" }));
    emit(onStateChange, failed);
    return failed;
  }
  if (loaded?.error?.code === "PROGRAM_NOT_FOUND") {
    const noProgram = result("no-cloud-program");
    emit(onStateChange, noProgram);
    return noProgram;
  }
  if (loaded?.error?.code === "AUTHENTICATION_REQUIRED") {
    const failed = result("cloud-load-error", null, {
      code: "AUTHENTICATION_CHANGED",
      message: "The signed-in account changed while Winter Arc data was loading. Please try again.",
    });
    emit(onStateChange, failed);
    return failed;
  }
  if (loaded?.error || !loaded || !loaded.data) {
    const failed = result("cloud-load-error", null, safeError(loaded?.error));
    emit(onStateChange, failed);
    return failed;
  }
  let programId = null;
  if (typeof repository.getProgramMetadata === "function") {
    let metadata;
    try {
      metadata = await repository.getProgramMetadata();
    } catch {
      metadata = null;
    }
    if (metadata?.error || !metadata?.data?.id || metadata.data.userId !== auth.data.user.id) {
      const failed = result("cloud-load-error", null, safeError(metadata?.error));
      emit(onStateChange, failed);
      return failed;
    }
    programId = metadata.data.id;
  }
  const success = { ...result("loaded", loaded.data), userId: auth.data.user.id, programId };
  emit(onStateChange, success);
  return success;
}
