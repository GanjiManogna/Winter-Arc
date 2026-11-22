import { isSupabaseConfigured, supabase } from "../lib/supabase.js";
import { repositoryResult } from "./repositories/repositoryContract.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FRIENDS_CHALLENGE_UNAVAILABLE = {
  code: "CHALLENGE_UNAVAILABLE",
  message: "Friends Challenge is unavailable right now. Please try again.",
};

export function generateChallengeInviteCode(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.getRandomValues !== "function") return null;
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function safeFailure(error) {
  const message = String(error?.message || "");
  const code = message.match(/\b(AUTH_REQUIRED|INVALID_NAME|INVALID_DATE_RANGE|INVALID_INVITE_CODE|INVALID_INVITE|CHALLENGE_ENDED|ALREADY_MEMBER|OWNER_MUST_END|CHALLENGE_NOT_FOUND)\b/)?.[1];
  if (code) return { code, message: code };
  if (/network|fetch failed|failed to fetch/i.test(message)) {
    return { code: "NETWORK_ERROR", message: "Check your connection and try again." };
  }
  return FRIENDS_CHALLENGE_UNAVAILABLE;
}

/** Authenticated, aggregate-only RPC boundary for private Friends Challenges. */
export function createChallengeRepository({ client = supabase, configured = isSupabaseConfigured } = {}) {
  async function call(functionName, args = {}) {
    if (!client || (!configured && client === supabase)) {
      return repositoryResult(null, FRIENDS_CHALLENGE_UNAVAILABLE);
    }
    try {
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError || !authData?.user?.id) {
        return repositoryResult(null, { code: "AUTH_REQUIRED", message: "Sign in to use Friends Challenge." });
      }
      const { data, error } = await client.rpc(functionName, args);
      return error ? repositoryResult(null, safeFailure(error)) : repositoryResult(data, null);
    } catch (error) {
      return repositoryResult(null, safeFailure(error));
    }
  }

  return Object.freeze({
    list: () => call("winter_arc_challenge_list_mine"),
    create: ({ name, startDate, endDate, inviteCode }) => call("winter_arc_challenge_create", {
      p_name: name,
      p_start_date: startDate,
      p_end_date: endDate,
      p_invite_code: inviteCode,
    }),
    previewInvite: (inviteCode) => call("winter_arc_challenge_preview_invite", { p_invite_code: inviteCode }),
    join: (inviteCode) => call("winter_arc_challenge_join", { p_invite_code: inviteCode }),
    read: (challengeId) => call("winter_arc_challenge_read", { p_challenge_id: challengeId }),
    leave: (challengeId) => call("winter_arc_challenge_leave", { p_challenge_id: challengeId }),
    end: (challengeId) => call("winter_arc_challenge_end", { p_challenge_id: challengeId }),
  });
}

export const challengeRepository = createChallengeRepository();
