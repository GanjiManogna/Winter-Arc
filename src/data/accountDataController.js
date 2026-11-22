import { loadAccountProgress } from "./accountProgressService.js";

function loadingState(userId = null) {
  return { status: "loading", progress: null, error: null, userId };
}

/** Keeps one account's cloud snapshot isolated from later auth identities. */
export function createAccountDataController({ loadProgress = loadAccountProgress } = {}) {
  let state = loadingState();
  let identity = "initializing";
  let requestVersion = 0;
  const listeners = new Set();

  function publish(next) {
    state = next;
    for (const listener of listeners) listener(state);
  }

  async function load(userId, version) {
    let result;
    try {
      result = await loadProgress({ expectedUserId: userId });
    } catch {
      result = {
        status: "cloud-load-error",
        progress: null,
        error: {
          code: "CLOUD_LOAD_FAILED",
          message: "Winter Arc data could not be loaded from the cloud. Please try again.",
        },
      };
    }
    if (version !== requestVersion || identity !== userId) return state;
    publish({ ...result, userId });
    return state;
  }

  return Object.freeze({
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setAccount({ userId = null, loading = false } = {}) {
      const nextIdentity = loading ? "initializing" : userId || "unauthenticated";
      if (identity === nextIdentity) return Promise.resolve(state);
      identity = nextIdentity;
      const version = ++requestVersion;

      if (loading) {
        publish(loadingState());
        return Promise.resolve(state);
      }
      if (!userId) {
        publish({ status: "unauthenticated", progress: null, error: null, userId: null });
        return Promise.resolve(state);
      }

      // Clear the previous account's data synchronously before starting I/O.
      publish(loadingState(userId));
      return load(userId, version);
    },
    retry(expectedUserId = null) {
      if (expectedUserId && identity !== expectedUserId) return Promise.resolve(state);
      if (!identity || identity === "initializing" || identity === "unauthenticated") {
        return Promise.resolve(state);
      }
      const userId = identity;
      const version = ++requestVersion;
      publish(loadingState(userId));
      return load(userId, version);
    },
    async refresh(expectedUserId) {
      if (
        !expectedUserId || identity !== expectedUserId || state.status !== "loaded"
        || state.userId !== expectedUserId
      ) return state;
      const version = ++requestVersion;
      let result;
      try {
        result = await loadProgress({ expectedUserId });
      } catch {
        return state;
      }
      if (version !== requestVersion || identity !== expectedUserId) return state;
      if (result?.status === "loaded" && result.userId === expectedUserId && result.programId === state.programId) {
        publish({ ...result, userId: expectedUserId, syncError: null });
      } else if (result?.status === "unauthenticated" || result?.status === "no-cloud-program") {
        publish({ ...result, userId: null });
      } else if (result?.status === "cloud-load-error") {
        publish({ ...state, syncError: result.error || null });
      }
      return state;
    },
    applyDailyEntry({ userId, programId, dateISO, ritualId, entry }) {
      if (
        identity !== userId
        || state.status !== "loaded"
        || state.userId !== userId
        || !programId
        || state.programId !== programId
      ) return false;

      requestVersion += 1;
      const currentDay = state.progress.entries?.[dateISO] || {};
      publish({
        ...state,
        progress: {
          ...state.progress,
          entries: {
            ...state.progress.entries,
            [dateISO]: { ...currentDay, [ritualId]: entry },
          },
        },
      });
      return true;
    },
    applyCustomHabit({ userId, programId, dateISO, habit, ritualSnapshot }) {
      if (
        identity !== userId
        || state.status !== "loaded"
        || state.userId !== userId
        || !programId
        || state.programId !== programId
        || !habit?.id
        || !Array.isArray(ritualSnapshot)
      ) return false;

      requestVersion += 1;
      const habits = state.progress.customHabits || [];
      publish({
        ...state,
        progress: {
          ...state.progress,
          customHabits: [...habits.filter((item) => item.id !== habit.id), habit]
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
          ritualSnapshots: Array.isArray(ritualSnapshot)
            ? { ...state.progress.ritualSnapshots, [dateISO]: ritualSnapshot }
            : state.progress.ritualSnapshots,
        },
      });
      return true;
    },
    applyWeeklyReflection({ userId, programId, weekStart, reflection }) {
      if (
        identity !== userId || state.status !== "loaded" || state.userId !== userId
        || !programId || state.programId !== programId || !weekStart || !reflection
      ) return false;
      requestVersion += 1;
      publish({
        ...state,
        progress: {
          ...state.progress,
          weeklyReflections: {
            ...(state.progress.weeklyReflections || {}),
            [weekStart]: { wins: reflection.wins, challenges: reflection.challenges, focus: reflection.focus, revision: reflection.revision },
          },
        },
      });
      return true;
    },
    applyMonthlyReflection({ userId, programId, month, reflection }) {
      if (
        identity !== userId || state.status !== "loaded" || state.userId !== userId
        || !programId || state.programId !== programId || !month || typeof reflection?.intention !== "string"
      ) return false;
      requestVersion += 1;
      publish({
        ...state,
        progress: {
          ...state.progress,
          monthlyReflections: {
            ...(state.progress.monthlyReflections || {}),
            [month]: { intention: reflection.intention, revision: reflection.revision },
          },
        },
      });
      return true;
    },
  });
}
