# Phase 13C-8D — Daily Ritual Progress Cloud Writes

## Scope

This phase enables writes for daily ritual entries in an authenticated account with successfully loaded cloud progress. It does not change the Supabase schema, run migration, add programs, or enable custom-habit or reflection writes.

## Write architecture

Ritual pages continue to use the existing account lifecycle and repository boundary:

1. Today links to the existing ritual route in cloud mode.
2. `RitualPage` receives the loaded account progress and its `userId`/`programId` from `useAccountDataLifecycle`.
3. The page merges an edit with the current confirmed entry using the shared `mergeRitualEntry` helper.
4. `saveDailyRitualEntry` verifies the active session before and after the write and calls `cloudRepository.writeDailyEntry` with the expected account and program.
5. The repository verifies the authenticated user, selects only that user's existing program (and the expected program ID), then upserts the daily row using the existing composite conflict key.
6. On confirmation, `applyDailyEntry` updates the account lifecycle's in-memory cloud progress. Today, History, Journey, and Analysis derive their views from that updated data.

The browser uses the configured Supabase client and its public anon key. RLS remains the database ownership boundary. The write path neither creates an `arc_programs` row nor calls migration code.

## Entry fields and ritual semantics

Writes preserve `completed`, `value`, `completedAt`, and ordered `applicationTimes`; omitted optional values are normalized safely. Measurable completion continues to come from the shared ritual status helper through `mergeRitualEntry`. Boolean rituals retain their existing completion behavior. Sunscreen keeps its current completion state and all application timestamps. Sleep Tracker remains an informational record: its value is saved, while `completed` and `completedAt` remain false/null and it remains excluded from completion totals.

Custom-habit pages stay visible, but cloud editing is disabled with a small status message. Weekly and monthly reflections remain read-only in cloud mode.

## Cloud and local persistence

- **Authenticated cloud mode:** the ritual page saves through the cloud repository and does not call `saveProgress` or mutate localStorage. Numeric fields remain editable and are saved with the existing Save Progress action; the water, step, and duration controls save through that same cloud path.
- **Local mode:** the existing `upsertRitualEntry` and `setRitualComplete` paths continue to save through the existing localStorage implementation. No Supabase write is made.
- **Cloud data unavailable:** existing local fallback behavior is retained; the cloud write path is used only after cloud progress has loaded successfully.

## Save feedback, recovery, and account changes

The UI shows a quiet saving/saved status. On failure, it restores the last confirmed entry, explains that the save failed, and offers a retry for the attempted patch. It does not silently save to localStorage. A write is rejected before submission if the current user differs from the displayed account. The repository also checks the exact expected program. If the session changes during the request, the result is rejected and is not applied to the currently displayed account; stale lifecycle updates are ignored, and the page requests a fresh account load.

Repeated writes use `onConflict: program_id,user_id,entry_date,ritual_id`, so edits update the same daily entry instead of adding duplicates.

## Automated coverage

Added synthetic tests cover measurable and boolean values, completion timestamps, sunscreen timestamp ordering, informational sleep behavior, repeated daily identities, rejected owner/program changes, mid-request account changes, failure feedback, no localStorage access in the cloud service, and propagation through Today, History, Journey, and daily/weekly/monthly analysis readers. Existing repository tests continue to cover localStorage persistence and local/cloud repository contracts.

## Manual verification

Live-account verification has not been performed in this implementation pass. No user data was edited. After review, verify with one harmless value:

1. Sign in and open Today; confirm it says “Showing your cloud progress for this account.”
2. Open one measurable ritual, adjust a low-risk value, and use **Save Progress** if editing the numeric field.
3. Wait for “Saved to your account,” refresh, and confirm the value remains.
4. Open History/Journey/Analysis and confirm the saved value or resulting status appears.
5. Restore the original value and confirm it saves.
6. Confirm one row exists for that account, program, date, and ritual. No bulk edits or migration are needed.

Signed-out/local behavior is covered by automated repository tests. This pass did not use an authenticated browser session, so no live save, refresh, or cross-page browser check was run.

## Validation and limitations

- `npm test`: **61 passed**, 0 failed.
- `npm run build`: **passed**. Vite emitted its existing large-chunk advisory for the 582 kB minified JavaScript bundle.
- Targeted ESLint across edited React/JavaScript source and test files: **passed**.
- No schema or migration changes were made; no program creation path was added.
- Live manual verification was not run because no authenticated browser session was available. Supabase session/RLS behavior is covered here with mocked/synthetic tests; the manual check above remains necessary before relying on a real account write.

This phase does not add multi-device conflict resolution or offline queuing.
