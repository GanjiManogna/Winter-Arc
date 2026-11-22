import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createChallengeRepository, generateChallengeInviteCode } from "../src/data/challengeRepository.js";
import { RITUALS } from "../src/data/rituals.js";
import { getRitualStatus } from "../src/data/ritualStatus.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("invite codes use browser cryptography and are non-sequential high-entropy values", () => {
  const cryptoMock = { getRandomValues(bytes) { bytes.forEach((_, index) => { bytes[index] = index; }); return bytes; } };
  const code = generateChallengeInviteCode(cryptoMock);
  assert.equal(code.length, 16);
  assert.match(code, /^[A-Z2-9]{16}$/);
  assert.notEqual(generateChallengeInviteCode(null), "");
  assert.equal(generateChallengeInviteCode(null), null);
});

test("challenge repository requires the current authenticated account and only invokes challenge RPCs", async () => {
  const calls = [];
  const client = {
    auth: { async getUser() { return { data: { user: { id: "account-a", email: "private@example.com" } }, error: null }; } },
    async rpc(name, args) { calls.push({ name, args }); return { data: name.endsWith("create") ? "challenge-uuid" : [], error: null }; },
  };
  const repository = createChallengeRepository({ client, configured: true });
  const result = await repository.create({ name: "Winter Together", startDate: "2026-10-05", endDate: "2027-01-02", inviteCode: "ABCDEFGHJKLMNPQR" });

  assert.equal(result.data, "challenge-uuid");
  assert.deepEqual(calls, [{
    name: "winter_arc_challenge_create",
    args: { p_name: "Winter Together", p_start_date: "2026-10-05", p_end_date: "2027-01-02", p_invite_code: "ABCDEFGHJKLMNPQR" },
  }]);
  assert.equal(Object.keys(repository).sort().join(","), "create,end,join,leave,list,previewInvite,read");
});

test("challenge read and member presentation preserve 10+ simulated members", async () => {
  const simulatedMembers = Array.from({ length: 12 }, (_, index) => ({
    display_name: `Test Member ${String(index + 1).padStart(2, "0")}`,
    role: index === 0 ? "owner" : "member",
    progress_percent: index === 0 ? 100 : index * 7,
  }));
  const calls = [];
  const repository = createChallengeRepository({
    configured: true,
    client: {
      auth: { async getUser() { return { data: { user: { id: "test-account" } }, error: null }; } },
      async rpc(name, args) {
        calls.push({ name, args });
        return {
          data: { id: "test-challenge", member_count: simulatedMembers.length, members: simulatedMembers },
          error: null,
        };
      },
    },
  });

  const result = await repository.read("test-challenge");
  const page = await read("../src/components/FriendsChallengePage.jsx");
  const sql = await read("../supabase/migrations/20261004110000_friends_challenge_v1.sql");
  const membersTable = sql.match(/create table public\.winter_arc_challenge_members\s*\([\s\S]*?\n\);/)?.[0];
  const joinFunction = sql.match(/create or replace function public\.winter_arc_challenge_join\([\s\S]*?\n\$\$;/)?.[0];
  const readFunction = sql.match(/create or replace function public\.winter_arc_challenge_read\([\s\S]*?\n\$\$;/)?.[0];

  assert.equal(result.error, null);
  assert.equal(result.data.members.length, 12);
  assert.equal(result.data.members[0].display_name, "Test Member 01");
  assert.equal(result.data.members[11].display_name, "Test Member 12");
  assert.deepEqual(calls, [{ name: "winter_arc_challenge_read", args: { p_challenge_id: "test-challenge" } }]);
  assert.ok(membersTable && joinFunction && readFunction);
  assert.doesNotMatch(membersTable, /member.?limit|max.?members|count\s*\(/i);
  assert.doesNotMatch(joinFunction, /member.?limit|max.?members|count\s*\(|limit\s+\d+/i);
  assert.match(readFunction, /jsonb_agg\(jsonb_build_object\([\s\S]*?'progress_percent'/);
  assert.doesNotMatch(readFunction, /limit\s+\d+/i);
  assert.match(page, /challenge\.members\.map/);
  assert.doesNotMatch(page, /challenge\.members\.slice|challenge\.members\.splice/);
});

test("unauthenticated requests are refused before RPC execution", async () => {
  let rpcCalled = false;
  const repository = createChallengeRepository({
    configured: true,
    client: {
      auth: { async getUser() { return { data: { user: null }, error: null }; } },
      async rpc() { rpcCalled = true; return { data: null, error: null }; },
    },
  });
  const result = await repository.list();
  assert.equal(result.error.code, "AUTH_REQUIRED");
  assert.equal(rpcCalled, false);
});

test("challenge migration validates dates, membership, invites, and owner-only ending", async () => {
  const sql = await read("../supabase/migrations/20261004110000_friends_challenge_v1.sql");
  assert.match(sql, /create table public\.winter_arc_challenges/);
  assert.match(sql, /create table public\.winter_arc_challenge_members/);
  assert.match(sql, /end_date > start_date/);
  assert.match(sql, /invite_code text not null unique/);
  assert.match(sql, /p_end_date <= p_start_date/);
  assert.match(sql, /for update;/);
  assert.match(sql, /if v_challenge\.status = 'ended' or v_challenge\.end_date < current_date/);
  assert.match(sql, /if v_role = 'owner' then raise exception 'OWNER_MUST_END'/);
  assert.match(sql, /where c\.id = p_challenge_id and c\.owner_id = v_user_id and c\.status = 'active'/);
  assert.match(sql, /winter_arc_challenge_one_owner_idx/);
});

test("challenge scores aggregate only completed core rituals inside active dates", async () => {
  const sql = await read("../supabase/migrations/20261004110000_friends_challenge_v1.sql");
  const scoreFunction = sql.match(/create or replace function private\.winter_arc_challenge_member_progress\([\s\S]*?\n\$\$;/)?.[0];
  assert.ok(scoreFunction);
  assert.match(scoreFunction, /v_last_day := least\(v_challenge\.end_date, current_date\)/);
  assert.match(scoreFunction, /e\.entry_date between v_first_day and v_last_day/);
  assert.match(scoreFunction, /where p\.user_id = p_user_id/);
  assert.match(scoreFunction, /and e\.program_id = v_program_id/);
  assert.match(scoreFunction, /e\.completed is true/);
  assert.match(scoreFunction, /e\.record_kind in \('boolean', 'measurable'\)/);
  assert.match(scoreFunction, /e\.custom_habit_id is null/);
  assert.match(scoreFunction, /'wake', 'sunscreen', 'water', 'steps', 'workout', 'food',[\s\S]*?'no-junk-food', 'learn', 'meditate', 'sleep', 'skincare'/);
  assert.match(scoreFunction, /cardinality\(array_remove\(v_core_rituals, 'skincare'\)\)/);
  assert.match(scoreFunction, /v_last_day - greatest\(v_first_day, date '2026-10-02'\) \+ 1/);
  assert.doesNotMatch(scoreFunction, /generate_series/);
  assert.doesNotMatch(scoreFunction, /'sleep-tracker'/);
  const appCoreIds = RITUALS.filter((ritual) => ritual.id !== "sleep-tracker").map((ritual) => ritual.id);
  const scoredIds = [...scoreFunction.matchAll(/'([a-z-]+)'/g)].map(([, id]) => id).filter((id) => appCoreIds.includes(id));
  assert.deepEqual(new Set(scoredIds), new Set(appCoreIds));
  assert.equal(getRitualStatus({ id: "workout", goal: 45 }, { value: 15 }).completed, false);
  assert.equal(getRitualStatus({ id: "workout", goal: 45 }, { value: 45 }).completed, true);
  assert.equal(getRitualStatus({ id: "sleep-tracker", goalMin: 7, goalMax: 9 }, { value: 8 }).completed, false);
});

test("leave and end RPCs are scoped to membership and do not mutate personal ritual data", async () => {
  const sql = await read("../supabase/migrations/20261004110000_friends_challenge_v1.sql");
  const joinFunction = sql.match(/create or replace function public\.winter_arc_challenge_join\([\s\S]*?\n\$\$;/)?.[0];
  const leaveFunction = sql.match(/create or replace function public\.winter_arc_challenge_leave\([\s\S]*?\n\$\$;/)?.[0];
  const endFunction = sql.match(/create or replace function public\.winter_arc_challenge_end\([\s\S]*?\n\$\$;/)?.[0];
  assert.ok(joinFunction && leaveFunction && endFunction);

  assert.match(joinFunction, /for update/);
  assert.match(joinFunction, /if v_challenge\.status = 'ended' or v_challenge\.end_date < current_date/);
  assert.match(joinFunction, /ALREADY_MEMBER/);
  assert.match(leaveFunction, /if v_role = 'owner' then raise exception 'OWNER_MUST_END'/);
  assert.match(leaveFunction, /delete from public\.winter_arc_challenge_members[\s\S]*?and m\.role = 'member'/);
  assert.doesNotMatch(leaveFunction, /daily_ritual_entries|arc_programs|ritual_snapshots|custom_habits|reflections/);
  assert.match(endFunction, /where c\.id = p_challenge_id and c\.owner_id = v_user_id and c\.status = 'active'/);
  assert.match(endFunction, /set status = 'ended', ended_at = now\(\)/);
  assert.doesNotMatch(endFunction, /delete from|daily_ritual_entries|arc_programs|ritual_snapshots|custom_habits|reflections/);
});

test("challenge RPCs are authenticated, member-scoped, and expose only names plus aggregate progress", async () => {
  const sql = await read("../supabase/migrations/20261004110000_friends_challenge_v1.sql");
  const readFunction = sql.match(/create or replace function public\.winter_arc_challenge_read\([\s\S]*?\n\$\$;/)?.[0];
  assert.ok(readFunction);
  assert.match(sql, /alter table public\.winter_arc_challenges enable row level security/);
  assert.match(sql, /alter table public\.winter_arc_challenge_members enable row level security/);
  assert.match(sql, /revoke all on table public\.winter_arc_challenges, public\.winter_arc_challenge_members/);
  assert.match(readFunction, /if v_user_id is null then raise exception 'AUTH_REQUIRED'/);
  assert.match(readFunction, /where m\.challenge_id = p_challenge_id and m\.user_id = v_user_id/);
  assert.match(readFunction, /'display_name', coalesce\(nullif\(btrim\(u\.raw_user_meta_data ->> 'display_name'\)/);
  assert.match(readFunction, /'Winter Arc Member'/);
  assert.match(readFunction, /'progress_percent', private\.winter_arc_challenge_member_progress/);
  assert.doesNotMatch(readFunction, /'email'|'user_id'|'ritual_id'|'sleep_time'|'completed_at'|'application_times'/);
  assert.match(sql, /grant execute on function public\.winter_arc_challenge_read\(uuid\) to authenticated/);
  assert.match(sql, /revoke all on function public\.winter_arc_challenge_read\(uuid\) from public, anon/);
});

test("challenge pages stay protected while Landing owns the entry point instead of Today", async () => {
  const app = await read("../src/App.jsx");
  const page = await read("../src/components/FriendsChallengePage.jsx");
  const today = await read("../src/components/TodayDashboard.jsx");
  const landing = await read("../src/components/LandingPage.jsx");
  assert.match(app, /<Route element=\{<RequireAuth \/>\}>[\s\S]*?<Route path="\/challenge"/);
  for (const route of ["/challenge/create", "/challenge/join", "/challenge/:challengeId"]) {
    assert.match(app, new RegExp(`<Route path="${route.replaceAll("/", "\\/")}"`));
  }
  assert.doesNotMatch(today, /today-friends-challenge|<Link to="\/challenge">Friends Challenge/);
  assert.match(landing, /Create Challenge/);
  assert.match(landing, /Join Challenge/);
  assert.match(landing, /loadLandingChallengeSummary\(challengeRepository\)/);
  assert.match(page, /challenge\.members\.map/);
  assert.match(page, /member\.display_name/);
  assert.match(page, /member\.progress_percent/);
  assert.doesNotMatch(page, /member\.email|member\.user_id|member\.ritual/);
  assert.match(page, /window\.confirm\(/);
  assert.match(page, /challengeRepository\.leave/);
  assert.match(page, /challengeRepository\.end/);
  assert.match(page, /key=\{`\$\{user\?\.id \|\| "signed-out"\}:\$\{location\.pathname\}`\}/);
  assert.match(page, /"That invite doesn't seem to be valid\."/);
  const migration = await read("../supabase/migrations/20261004110000_friends_challenge_v1.sql");
  const leaveFunction = migration.match(/create or replace function public\.winter_arc_challenge_leave\([\s\S]*?\n\$\$;/)?.[0];
  assert.ok(leaveFunction);
  assert.match(leaveFunction, /delete from public\.winter_arc_challenge_members/);
  assert.doesNotMatch(leaveFunction, /daily_ritual_entries|arc_programs|ritual_snapshots/);
});
