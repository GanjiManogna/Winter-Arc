# Phase 13C-8F — Custom Habit Cloud Writes

## Scope

Authenticated cloud mode can create custom habits and persist their daily progress using the existing `custom_habits`, `custom_habit_definitions`, `ritual_snapshots`, and `daily_ritual_entries` tables. This phase changes no schema, RLS policy, migration, program lifecycle, reflection write, or local/cloud merge behavior.

## Creation and definitions

The existing Add Custom Habit form remains the entry point. Local mode still calls the established `createCustomHabit()` storage flow. Cloud mode builds the same normalized habit shape with a request-stable logical habit id, database id, and definition id. The cloud service verifies the current authenticated user before and after the writes and passes the displayed user and program to every repository call.

Creation upserts the owner-scoped `custom_habits` row, a version 1 definition effective from the habit's `createdAt`, and the complete ritual definition snapshot for the creation date. The snapshot retains the definitions already saved for that date and appends the new custom ritual. Conflict keys and stable request ids let retrying the same pending request update the same records. The confirmed cloud values update in-memory account data; cloud mode does not call local `saveProgress()` or write a hidden browser copy.

The creation requests are sequential upserts rather than one database transaction. If a later upsert fails, the UI reports failure and retains the same request identity for retry; an already completed earlier upsert is safe to retry. The database schema provides the uniqueness constraints and RLS ownership boundary. The authenticated client does not create programs or use service-role credentials.

## Daily progress, history, and analysis

Existing ritual status and entry behavior handles both boolean and measurable custom habits. The existing RitualPage save path passes the logical custom habit id with the daily entry. The repository verifies the habit under the authenticated owner and current program, then stores its database UUID in `daily_ritual_entries.custom_habit_id` while preserving the existing date/ritual upsert identity. Measurable values retain the existing partial and goal-completion semantics.

Custom habit creation records the full date-specific ritual snapshot. Later daily writes do not rewrite snapshots or old daily entries. History therefore reads each date's stored definition, and Today, Journey, and daily/weekly/monthly analysis continue consuming the reconstructed progress model and existing formulas. Archived custom habits remain represented in their historical snapshots; the current UI has no custom-habit archive or definition-edit action, so this phase adds neither.

## Ownership, stale requests, and failures

Cloud repository writes resolve identity through Supabase Auth, scope the program by user and expected program, and query custom habits by owner/program/source id. RLS remains the server-side enforcement boundary. The account controller only applies the confirmed habit and snapshot while the same user and program are still loaded. If identity changes during a request, the result is discarded and the guarded account retry cannot reload a different user's data.

Failures do not claim success or fall back to local storage. A calm inline error offers retry. A failed create keeps its original identifiers bound to the account/program that started it; it cannot be resubmitted for another account without canceling that draft. Successful creation clears the pending request and displays the confirmed cloud state.

## Local/cloud separation and duplicate prevention

Signed-out/local mode retains existing localStorage creation and progress writes. Authenticated cloud mode reads and writes the account's cloud model only; it does not merge or upload local custom habits. Habit source id, stable database id, definition id/version, and date/ritual keys are reused for retries. Daily entries use the existing unique owner/date/ritual identity, so repeated saves update the record instead of adding duplicates. No migration or `arc_programs` write is run by this feature.

## Automated verification

Tests cover local creation, boolean/measurable status and writes, owner/program scoping, stale accounts, retry identity, failed-write behavior, localStorage isolation in cloud mode, repository upsert keys, daily custom-habit foreign-key linking, current and historical snapshots, account switching, and Today/History/Journey/analysis readers.

Validation commands:

```text
npm test
npm run build
npx eslint <edited React and source files>
```

No real credentials or account data are used by tests. No database schema, migration, or RLS files are modified.

## Manual browser verification

Run these checks in an authenticated browser session:

1. **Existing custom habit:** open Today, change a migrated habit's daily progress, save, refresh, and confirm the value remains.
2. **Create custom habit:** create one harmless test habit, confirm it appears in Today after saving and refresh, then confirm it appears in History for its creation date and belongs to the signed-in account.
3. **Account safety:** sign out and back into the same account; confirm the habit remains without a duplicate. If multiple test accounts are available, verify the other account cannot see it.
4. **Local mode:** sign out and verify local custom-habit creation and progress still use the existing local behavior.

The current execution environment did not provide an authenticated Winter Arc browser session, so these real-account checks remain for manual verification. There is no archive/delete UI. To remove a test habit without erasing history, use the existing account's administrative data tooling to mark its `custom_habits.archived` field true; retain its definition, snapshots, and daily entries. The current product UI does not expose this operation.
