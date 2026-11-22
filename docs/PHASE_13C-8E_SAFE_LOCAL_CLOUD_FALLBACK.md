# Phase 13C-8E — Safe Local/Cloud Fallback

## Data modes

- **Local:** no active authenticated account or no cloud program. Existing localStorage behavior remains the persistence source.
- **Cloud:** an authenticated identity has successfully loaded its cloud program and complete progress snapshot. Supported daily ritual writes use the cloud repository.
- **Cloud fallback:** the account is authenticated but cloud loading failed. Pages show local browser data with an explicit fallback notice and retry control. Any available local editing remains local; it is never queued or uploaded automatically.
- **Loading:** auth or account data is transitioning. The account lifecycle clears cloud progress before loading, and pages show a loading state instead of the previous identity's data.
- **Operation error:** write failures retain the last confirmed cloud value, show a calm message, and offer retry. Network and authentication failures have application-level classifications with sanitized user messages.

## Authentication transitions and account isolation

`useAccountDataLifecycle` continues to bridge auth identity to one `createAccountDataController`. On sign-in, sign-out, or an A-to-B identity change, the controller increments its request version and clears account-scoped cloud state before loading. A stale read cannot replace the current account. The hook also renders loading whenever its current auth identity does not match the controller snapshot, preventing an account-data flash during effect transitions.

Supabase Auth change events continue to drive session transitions. When a daily write detects that the expected session is gone or changed, the ritual page requests a reload scoped to the account that initiated the request. The controller refuses that retry if its active identity has changed, so an old User A callback cannot refresh User B. Sign-out publishes an unauthenticated state with no cloud progress; the app returns to local mode.

## Read failures, retry, and refresh

Cloud repository reads fail as a whole if a required table fails. `loadAccountProgress` returns no partial progress, and the controller now converts unexpected rejected loads into a safe cloud-load-error state rather than remaining stuck on loading. The UI then reads local progress and identifies it as fallback. A retry starts in loading with the old cloud snapshot cleared. A successful retry replaces fallback with the full cloud model; a failed retry returns to the explicitly labeled fallback state.

On refresh, the account lifecycle starts empty and waits for auth and a complete cloud load before showing authenticated data. Signed-out mode reads local progress. No local data is compared with, merged into, uploaded to, or used to overwrite cloud data.

## Daily cloud write failure and connectivity

The Phase 13C-8D ritual write path remains the only supported daily cloud write path. It verifies the expected session, user, and program; a successful write is merged into current in-memory cloud progress. A failed or interrupted request is not reported as success and does not call local `saveProgress`. The ritual page restores its confirmed entry and displays retry feedback. Retrying targets the same daily unique identity, so a repeated request updates the same row.

Cloud repository errors distinguish missing/expired authentication and common network failures from general cloud request failures while returning sanitized messages. RLS remains the database ownership boundary. Cloud reads and writes only select an existing account-owned program; no program creation or migration path is invoked.

## Data boundary

- Cloud mode never mirrors supported ritual writes into localStorage.
- Local/fallback editing uses only the existing local persistence path.
- Fallback changes are not treated as cloud changes and are never uploaded on retry or sign-in.
- Cloud daily rows preserve completion, value, completion timestamps, sunscreen application timestamps, and informational Sleep Tracker semantics.
- Applying a confirmed daily entry changes only the in-memory `entries[date][ritualId]` value. Historical ritual snapshots, reflections, and other account data are retained unchanged.

## Automated tests

Synthetic test coverage now includes sign-in/sign-out and A-to-B transitions, stale read/write isolation, expired session exit, rejected and partial cloud loads, successful and failed retries, cloud/local write boundaries, failed/network write behavior, confirmed-value retention, refresh loading state, duplicate daily upserts, existing-program ownership, absence of program creation/migration, downstream Today/History/Journey/analysis reads, Sleep Tracker information-only status, sunscreen timestamp ordering, historical snapshot preservation, and existing local storage persistence.

## Manual verification plan

No live-account tests were run in this implementation pass. The available browser context had no tabs or authenticated session, and no real account data was edited.

For later safe browser verification:

1. **Cloud success:** sign in, open Today, change one harmless measurable value, save, refresh, and confirm it remains.
2. **Sign out:** sign out and confirm local mode appears with no cloud account data treated as active.
3. **Sign in again:** sign in and confirm the existing cloud data loads and the existing program remains singular.
4. **Refresh:** refresh while authenticated and confirm loading precedes cloud data with no stale account flash.
5. **Error:** if it can be simulated safely, interrupt a read and confirm local fallback is labeled, local data remains intact, and retry recovers when connectivity returns.

Do not perform destructive tests or rerun migration. Restore the harmless value used in the cloud success check after verifying persistence.

## Validation and limitations

- `npm test`: **70 passed**, 0 failed.
- `npm run build`: **passed**. Vite emitted a bundle-size advisory for the 584 kB minified JavaScript bundle.
- Targeted ESLint on changed JavaScript/React source and test files: **passed**.
- No schema, RLS, or migration files were modified. No automatic merge or program creation was added.
- No live manual verification was run because no authenticated browser session was available. Tests use mocked/synthetic auth and repository responses; they do not replace verification of Supabase Auth event delivery, live RLS behavior, or an actual account switch in a browser.

This phase does not implement offline synchronization, conflict resolution, custom-habit writes, or reflection writes.
