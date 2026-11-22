import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getDisplayName } from "../src/auth/displayName.js";
import { personalizeGreetingHeading, TIME_COPY } from "../src/data/todayExperience.js";

const authPage = readFileSync(new URL("../src/components/AuthPage.jsx", import.meta.url), "utf8");
const authService = readFileSync(new URL("../src/auth/authService.js", import.meta.url), "utf8");

test("signup collects a required display name and persists it in Supabase user metadata", () => {
  assert.match(authPage, /isSignup && \([\s\S]*?name="name"[\s\S]*?required/);
  assert.match(authPage, /signUp\(\{ email: email\.trim\(\), password, displayName: name\.trim\(\) \}\)/);
  assert.match(authService, /data: \{ display_name: trimmedName \}/);
  assert.match(authService, /user: session\?\.user \|\| null/);
});

test("authenticated identity exposes only a trimmed display name for personalization", async () => {
  const provider = readFileSync(new URL("../src/auth/AuthProvider.jsx", import.meta.url), "utf8");
  const first = { id: "account-a", email: "private-a@example.com", user_metadata: { display_name: "  Manu  " } };
  const second = { id: "account-b", email: "private-b@example.com", user_metadata: { display_name: "Ananya" } };

  assert.equal(getDisplayName(first), "Manu");
  assert.equal(getDisplayName(second), "Ananya");
  assert.equal(getDisplayName({ user_metadata: { display_name: "   " } }), null);
  assert.equal(getDisplayName({ user_metadata: { display_name: 42 } }), null);
  assert.match(provider, /displayName: getDisplayName\(authState\.user\)/);
  assert.match(provider, /setAuthState\(\{ session, user, loading: false \}\)/);
  assert.match(provider, /setAuthState\(\{\s*session: error \? null : data\.session,\s*user: error \? null : data\.user/);
});

test("time-aware greeting uses the authenticated name and safely preserves generic copy", async () => {
  const dashboard = readFileSync(new URL("../src/components/TodayDashboard.jsx", import.meta.url), "utf8");

  assert.equal(personalizeGreetingHeading(TIME_COPY.morning.heading, " Manu "), "Good morning, Manu.");
  assert.equal(personalizeGreetingHeading(TIME_COPY.afternoon.heading, "Ananya"), "Keep going, Ananya.");
  assert.equal(personalizeGreetingHeading(TIME_COPY.evening.heading, "Rahul"), "You made it this far, Rahul.");
  assert.equal(personalizeGreetingHeading(TIME_COPY.night.heading, null), TIME_COPY.night.heading);
  assert.equal(personalizeGreetingHeading(TIME_COPY.morning.heading, "   "), TIME_COPY.morning.heading);
  assert.match(dashboard, /const \{ displayName \} = useAuth\(\)/);
  assert.match(dashboard, /personalizeGreetingHeading\(timeCopy\.heading, displayName\)/);
  assert.doesNotMatch(dashboard, /localStorage\s*\.\s*setItem\([^)]*name/i);
});

test("logout clears the account-scoped display name and challenge identity needs no email", async () => {
  const provider = readFileSync(new URL("../src/auth/AuthProvider.jsx", import.meta.url), "utf8");
  const context = readFileSync(new URL("../src/auth/authContext.js", import.meta.url), "utf8");
  const displayNameSource = readFileSync(new URL("../src/auth/displayName.js", import.meta.url), "utf8");

  assert.match(provider, /user: authState\.user,\s*displayName: getDisplayName\(authState\.user\)/);
  assert.match(provider, /setAuthState\(\{ session, user, loading: false \}\)/);
  assert.match(context, /createContext\(null\)/);
  assert.doesNotMatch(displayNameSource, /email|localStorage|user\.id/i);
});
