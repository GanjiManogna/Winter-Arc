# Phase 13C-8G — Weekly and Monthly Reflection Cloud Writes

## Persistence paths

Weekly reflection saves retain the existing `{ wins, challenges, focus }` model and Winter Arc week-start calculation. The Journey page uses the active week key and writes through `saveWeeklyReflectionToCloud` to `weekly_reflections`.

Monthly reflection saves retain the existing `{ intention }` model and `getMonthKey()` value. The Journey page writes through `saveMonthlyReflectionToCloud` to `monthly_reflections`; the repository maps the application `YYYY-MM` key to the database's first-of-month date and maps the confirmed result back.

The authenticated UI keeps the existing textareas. Weekly fields save on blur and when navigating away from the selected week. Monthly cloud intention saves on blur and when navigating away from the selected month. Save status is shown inline with a retry action on failure. Signed-out/local autosave behavior continues using the existing `saveWeeklyReflection` and `saveMonthlyIntention` functions.

## Ownership, stale requests, and failures

The write service verifies the current Supabase user before and after the repository operation, then passes the expected user and displayed program to the repository. The repository verifies both through its authenticated context and uses existing owner/program-scoped RLS. Weekly and monthly upserts conflict on their existing `(program_id, user_id, week_start)` and `(program_id, user_id, month)` identities.

The account controller applies confirmed reflection values only when the same user and program are still loaded. If a session changes during a save, its result is rejected; any retry is guarded by the old user id and cannot reload a different account. A failure remains visible and never reports “Saved.” The text draft stays available so the user can retry; cloud failures never fall back to localStorage.

## Analysis and local/cloud separation

Reflections are stored in the existing reconstructed `weeklyReflections` and `monthlyReflections` progress fields. Journey's weekly notes and monthly intention read from that shared account progress immediately after a confirmed save and after reload. There is no separate analysis reflection store. Local reflections are not merged or uploaded after login; cloud mode uses only the authenticated cloud model.

No schema, RLS, migration, program creation, ritual behavior, or analysis formula was changed.

## Automated tests

Tests cover local weekly/monthly persistence, cloud ownership and program scoping, all weekly fields, monthly intention, exact week/month keys, idempotent upserts, safe failures, no local fallback, stale-account rejection, account-state clearing, and reflection readers consuming confirmed account progress.

Validation commands:

```text
npm test
npm run build
npx eslint <edited React and source files>
```

All automated test data is synthetic; tests use no real credentials.

## Manual browser verification

The current execution environment did not provide an authenticated Winter Arc browser session. Manually verify:

1. **Weekly:** sign in, open Journey / Weekly Check-in, edit Wins, Challenges, and Focus one at a time, wait for “Saved,” refresh, and confirm each remains.
2. **Monthly:** edit the monthly intention, blur the field, wait for “Saved,” refresh, and confirm it remains.
3. **Analysis:** confirm Weekly Analysis shows the saved weekly notes and Monthly Reflection shows the saved intention.
4. **Local mode:** sign out and verify the existing local reflection behavior remains intact.

Use an existing account and week/month during verification; do not modify unrelated progress.
