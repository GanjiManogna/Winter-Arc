import { useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured } from "../lib/supabase";
import { getCurrentSession, subscribeToAuthChanges } from "./authService";
import { AuthContext } from "./authContext";
import { deactivateDeviceAfterAccountChange } from "../notifications/notificationService.js";
import { setProgressAccountScope } from "../data/storage.js";
import { getDisplayName } from "./displayName.js";

export function AuthProvider({ children }) {
  const lastUserId = useRef(null);
  const [authState, setAuthState] = useState({
    session: null,
    user: null,
    loading: isSupabaseConfigured,
  });

  useEffect(() => {
    let active = true;
    let authEventReceived = false;

    if (!isSupabaseConfigured) {
      return () => {
        active = false;
      };
    }

    const unsubscribe = subscribeToAuthChanges(({ session, user }) => {
      authEventReceived = true;
      const previousUserId = lastUserId.current;
      const nextUserId = user?.id || null;
      if (previousUserId && previousUserId !== nextUserId) {
        // Leave the Supabase auth callback before making a network request.
        window.setTimeout(() => {
          void deactivateDeviceAfterAccountChange();
        }, 0);
      }
      lastUserId.current = nextUserId;
      if (active) {
        setProgressAccountScope(nextUserId);
        setAuthState({ session, user, loading: false });
      }
    });

    getCurrentSession().then(({ data, error }) => {
      if (!active || authEventReceived) return;
      lastUserId.current = error ? null : data.user?.id || null;
      setProgressAccountScope(error ? null : data.user?.id || null);
      setAuthState({
        session: error ? null : data.session,
        user: error ? null : data.user,
        loading: false,
      });
    });

    return () => {
      active = false;
      unsubscribe();
      setProgressAccountScope(null);
    };
  }, []);

  const value = useMemo(() => ({
    user: authState.user,
    displayName: getDisplayName(authState.user),
    session: authState.session,
    loading: authState.loading,
    isAuthenticated: Boolean(authState.user),
    status: authState.loading
      ? "initializing"
      : authState.user
        ? "authenticated"
        : "unauthenticated",
  }), [authState]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
