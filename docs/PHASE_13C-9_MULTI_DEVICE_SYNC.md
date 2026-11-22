# Phase 13C-9 — Multi-Device Sync and Conflict Handling

## Audit findings and schema safety

The existing migration defines `revision bigint not null default 1` and `updated_at timestamptz not null default now()` on `arc_programs`, `custom_habits`, `custom_habit_definitions`, `ritual_snapshots`, `daily_ritual_entries`, `weekly_reflections`, and `monthly_reflections`. Existing uniqueness identities remain unchanged: program/user/source habit; habit/version and habit/effective date; program/user/date/ritual snapshot; program/user/date/ritual daily entry; program/user/week; and program/user/month.

There is no database trigger that automatically changes `updated_at` or `revision`; the original migration explicitly reserves those fields for a sync protocol and says no revision trigger is installed. The implementation therefore does not use `updated_at` as a freshness token or trust browser time. It selects each row's server-stored revision and uses an atomic owner-scoped compare-and-swap: updates include `WHERE revision = expected` and write `expected + 1`; inserts start at revision 1 and a uniqueness race becomes a conflict. PostgreSQL evaluates the revision predicate with the update, so a stale current-app request changes zero rows and is rejected. No schema change or backfill is required because existing rows already have revision 1 or later.

Historical ritual snapshots have no set-level revision. Their write path is insert-only: it checks that existing rows match the displayed date snapshot, inserts only missing rows, and reports a conflict if another device added or changed a definition. Refresh never writes snapshots. Custom definitions are append-only versions; the latest definition revision is checked before adding a newer version. Stable retries of an already-present identical habit/definition are idempotent.

## Sync model and refresh

Authenticated Supabase data remains the source of truth. Browser memory is a cache; localStorage remains the independent source only in signed-out/local mode. On initial load, the account controller clears the previous identity before loading the authenticated program and reconstructs the current cloud records. Account identity and request generation checks discard stale results.

While an authenticated page is open, the lifecycle refreshes cloud data on focus and when the document becomes visible, with a 10-second throttle, plus a 60-second interval while visible. Background refresh keeps the last confirmed view until the new cloud load completes. If refresh fails, that data remains visible with a retry notice. Confirmed writes invalidate any older in-flight refresh so stale cached data cannot replace a newer write.

Supabase Realtime is not enabled here. The repository migration does not configure table publication/subscriptions, and adding live subscriptions would require verifying and maintaining publication settings. Focus/visibility refresh plus one-minute visible-page refresh is the simpler bounded approach. Other devices become visible on the next refresh or page reload.

## Conflict policy by data

- **Daily ritual entries:** the complete row is one revision. A stale write, including sunscreen `application_times`, is rejected as a whole. The client reloads the latest cloud value, shows a conflict message, and requires a new user edit before saving again. Sleep Tracker remains informational.
- **Custom habit daily progress:** uses the same daily entry revision and ownership check, independently from habit definition state.
- **Custom habits and definitions:** creation uses stable ids and insert/idempotency checks. Existing changed values are not overwritten by a stale creation retry. Definition versions are appended only when the expected latest revision still matches. There is no definition-edit UI in this phase.
- **Ritual snapshots:** refresh never writes snapshots. Creation inserts only missing rows after checking the date's existing definitions; a concurrent change is reported as a conflict instead of overwriting the date.
- **Weekly and monthly reflections:** each period is a revisioned record. Stale saves are rejected, the latest cloud reflection is loaded into the editor, and the user can then intentionally edit it.

Conflict reloads are scoped to the displayed authenticated user and program. A refresh for an old account cannot replace a newly selected account. All repository updates retain the existing RLS boundary and stable uniqueness keys. Repeated daily/reflection saves update the same logical row; custom creation retries keep their original identifiers. No code path creates another arc program or reruns migration.

## Offline limitations

Cloud writes still require a successful network request. A failure is surfaced and does not report success, queue a background mutation, or mirror the value into localStorage. The last confirmed cloud state stays authoritative, and the existing retry controls remain available. This phase does not implement offline queues or conflict merging.

Revision checks protect clients running the current compare-and-swap write paths. Because the schema has no trigger/RPC that forces every database writer to increment revision, a stale older application bundle or external client that continues using unconditional upserts could bypass the protocol. Reload all open Winter Arc sessions when deploying this version. If all-writer enforcement is required in a later phase, add a separately reviewed server-side trigger/RPC that owns revision increments and denies unguarded updates; no such schema change was applied here.

## Tests and validation

Automated synthetic tests cover a save on one device appearing after another device refreshes, stale daily and reflection revision rejection, latest-value reload, no stale account application, custom definition conflicts, insert-only snapshots, local-mode separation, sunscreen field preservation, Sleep Tracker semantics, history preservation, idempotent identities, and existing analysis readers.

```text
npm test
npm run build
npx eslint <edited React and source files>
```

No real credentials are used. No Supabase schema, RLS policy, SQL migration, or migration data was changed.

## Manual two-browser verification

No authenticated browser session was available during this implementation. Verify manually:

1. **Cross-device refresh:** in Browser A and Browser B, sign into the same account and open Today. Note Water in A, change and save it in B, then focus or refresh A and confirm the new value appears.
2. **Conflict:** set Water to 3 and load both browsers. In B, save 5. In stale A, attempt to save 4. A should show a newer-progress message and load 5; B must remain at 5. Repeat with sunscreen if desired and verify application timestamps are replaced by the latest confirmed record rather than merged.
3. **Custom habit and reflection:** verify latest custom daily progress, weekly notes, and monthly intention appear on the other browser after focus/visibility refresh.
4. **Local mode:** sign out and confirm the existing local behavior remains unchanged.

Do not use destructive data or manually alter database revisions during verification.
