import { isSupabaseConfigured, supabase } from "../lib/supabase.js";
import { deactivateCurrentDeviceSubscription } from "../notifications/notificationService.js";

const EMPTY_SESSION_ERROR = {
  code: "AUTH_UNAVAILABLE",
  message: "Authentication is not configured yet.",
};

const ERROR_DETAILS = [
  {
    matches: ["invalid_login_credentials", "invalid login credentials", "invalid_credentials"],
    code: "INVALID_CREDENTIALS",
    message: "The email or password is incorrect.",
  },
  {
    matches: ["email_not_confirmed", "email_not_confirm"],
    code: "EMAIL_NOT_CONFIRMED",
    message: "Confirm your email address before signing in.",
  },
  {
    matches: ["user_already_exists", "already registered", "already been registered"],
    code: "USER_ALREADY_EXISTS",
    message: "An account with this email address already exists.",
  },
  {
    matches: ["weak_password", "password should be", "password is too weak"],
    code: "WEAK_PASSWORD",
    message: "Choose a stronger password that meets the project's password requirements.",
  },
  {
    matches: ["email_address_invalid", "invalid email", "email is invalid"],
    code: "INVALID_EMAIL",
    message: "Enter a valid email address.",
  },
  {
    matches: ["over_email_send_rate_limit", "rate limit"],
    code: "RATE_LIMITED",
    message: "Too many authentication attempts. Please wait and try again.",
  },
];

function toSafeSession(session) {
  if (!session) return null;
  return {
    user: session.user || null,
    expiresAt: session.expires_at || null,
    expiresIn: session.expires_in || null,
    tokenType: session.token_type || null,
  };
}

function toSafeAuthError(error) {
  const searchable = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  const detail = ERROR_DETAILS.find(({ matches }) =>
    matches.some((match) => searchable.includes(match))
  );

  if (detail) {
    return { code: detail.code, message: detail.message };
  }

  if (error instanceof TypeError || /network|fetch failed|failed to fetch/.test(searchable)) {
    return {
      code: "NETWORK_ERROR",
      message: "Unable to reach the authentication service. Check your connection and try again.",
    };
  }

  return {
    code: "AUTH_ERROR",
    message: "Authentication could not be completed. Please try again.",
  };
}

async function runAuthRequest(request) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: EMPTY_SESSION_ERROR };
  }

  try {
    const { data, error } = await request();
    return error
      ? { data: null, error: toSafeAuthError(error) }
      : { data, error: null };
  } catch (error) {
    return { data: null, error: toSafeAuthError(error) };
  }
}

export function signUp({ email, password, displayName } = {}) {
  const trimmedName = typeof displayName === "string" ? displayName.trim() : "";
  const options = trimmedName
    ? { data: { display_name: trimmedName } }
    : undefined;

  return runAuthRequest(() => supabase.auth.signUp({
    email,
    password,
    ...(options ? { options } : {}),
  })).then(({ data, error }) => ({
    data: data
      ? {
          user: data.user,
          session: toSafeSession(data.session),
          confirmationRequired: Boolean(
            data.user && !data.session && (data.user.identities?.length ?? 0) > 0
          ),
        }
      : null,
    error,
  }));
}

export function signIn({ email, password } = {}) {
  return runAuthRequest(() => supabase.auth.signInWithPassword({ email, password }))
    .then(({ data, error }) => ({
      data: data
        ? { user: data.user, session: toSafeSession(data.session) }
        : null,
      error,
    }));
}

export function signOut() {
  return (async () => {
    if (isSupabaseConfigured && supabase) {
      try {
        await deactivateCurrentDeviceSubscription();
      } catch {
        // Local sign-out must remain available if device cleanup is offline.
      }
    }
    return runAuthRequest(() => supabase.auth.signOut());
  })();
}

export async function getCurrentSession() {
  const result = await runAuthRequest(() => supabase.auth.getSession());
  if (result.error) return result;

  const session = result.data?.session || null;
  return {
    data: { session: toSafeSession(session), user: session?.user || null },
    error: null,
  };
}

export function subscribeToAuthChanges(callback) {
  if (typeof callback !== "function" || !isSupabaseConfigured || !supabase) {
    return () => {};
  }

  try {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      callback({
        event,
        session: toSafeSession(session),
        user: session?.user || null,
      });
    });
    return () => data.subscription.unsubscribe();
  } catch {
    return () => {};
  }
}
