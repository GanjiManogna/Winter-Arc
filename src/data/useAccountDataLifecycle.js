import { useEffect, useState } from "react";
import { useAuth } from "../auth/useAuth.js";
import { createAccountDataController } from "./accountDataController.js";

const INITIAL_STATE = { status: "loading", progress: null, error: null, userId: null };

/** Bridges AuthProvider identity changes to the race-safe account data controller. */
export function useAccountDataLifecycle() {
  const { user, loading: authLoading } = useAuth();
  const [controller] = useState(() => createAccountDataController());
  const [state, setState] = useState(INITIAL_STATE);
  const currentUserId = user?.id || null;

  useEffect(() => controller.subscribe(setState), [controller]);

  useEffect(() => {
    controller.setAccount({ userId: currentUserId, loading: authLoading });
  }, [controller, currentUserId, authLoading]);

  useEffect(() => {
    if (authLoading || !currentUserId || state.status !== "loaded" || state.userId !== currentUserId) return undefined;
    let inFlight = false;
    let lastRefresh = 0;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || inFlight || Date.now() - lastRefresh < 10_000) return;
      inFlight = true;
      lastRefresh = Date.now();
      try {
        await controller.refresh(currentUserId);
      } finally {
        inFlight = false;
      }
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [controller, authLoading, currentUserId, state.status, state.userId]);

  const identityMatches = authLoading
    ? false
    : currentUserId
      ? state.userId === currentUserId
      : state.status === "unauthenticated";

  return {
    status: identityMatches ? state.status : "loading",
    progress: identityMatches ? state.progress : null,
    error: identityMatches ? (state.error || state.syncError || null) : null,
    identityKey: identityMatches ? (currentUserId || "local") : "loading",
    userId: identityMatches ? state.userId : null,
    programId: identityMatches ? state.programId : null,
    applyDailyEntry: (update) => controller.applyDailyEntry(update),
    applyCustomHabit: (update) => controller.applyCustomHabit(update),
    applyWeeklyReflection: (update) => controller.applyWeeklyReflection(update),
    applyMonthlyReflection: (update) => controller.applyMonthlyReflection(update),
    retry: (expectedUserId) => controller.retry(typeof expectedUserId === "string" ? expectedUserId : null),
    refresh: (expectedUserId) => controller.refresh(typeof expectedUserId === "string" ? expectedUserId : null),
  };
}
