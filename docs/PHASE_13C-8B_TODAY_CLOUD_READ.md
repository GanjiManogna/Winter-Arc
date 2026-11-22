# Phase 13C-8B — Today Cloud Read

## Scope

Today can now render a read-only snapshot loaded for the current authenticated account. The account progress service and cloud repository remain read-only; the repository factory still defaults to local, and no other page is connected to cloud data.

No database/schema, RLS, migration, ritual rules, or stored local data were changed. This phase performs no cloud writes.

## Account lifecycle and user-switch protection

`AuthProvider` remains the only source of the current authentication identity. `useAccountDataLifecycle` bridges that identity to `createAccountDataController`, which calls the existing `loadAccountProgress` service. The service rechecks the session and requires it to match the expected AuthProvider user before starting the cloud read.

The controller clears its previous progress synchronously when the identity changes, increments a request generation, and accepts a response only when both the request generation and active identity still match. Sign-out clears the cloud progress. A render-time identity check also hides the previous snapshot in the interval before React effects process the change.

## Today data-mode selection

| Account state | Today source and behavior |
| --- | --- |
| Auth initializing / cloud loading | Calm loading state; no local progress is read or displayed. |
| Unauthenticated | Existing localStorage-backed Today behavior. |
| Authenticated with a cloud program | The loaded cloud progress model drives Today. Cards are non-navigating read-only rows, and Add Custom Habit is disabled with an explanation. |
| Authenticated with no cloud program | Existing local data is shown with a notice. No cloud program is created and no data is overwritten. |
| Cloud load error | Existing local data is shown with a safe error notice and retry action. Cloud details are not exposed, and no merge or write is attempted. |

Cloud-mode progress uses existing `getRitualStatus` semantics. It retains current-day boolean/measurable entries, completion timestamps, sunscreen application times, active custom habits, and informational Sleep Tracker values. The display and completion calculations now use the 90-day Arc boundary.

## Read-only behavior and storage

Today does not call a cloud write operation. In cloud mode, ritual rows cannot navigate into local-only ritual editing, and custom habit creation is disabled. In local fallback modes, existing local controls remain available and continue using the established local behavior. The cloud model adapter does not access `localStorage`; tests use a sentinel storage object to verify that.

## Verification

- Automated tests use mocked sessions/repositories and synthetic records only; no production user data is used by tests.
- Tests cover auth states, no-program/error fallback modes, loading, clearing on sign-out and account change, out-of-order A/B responses, current Today values/custom habits, sunscreen timestamps, and informational Sleep Tracker status.
- `npm test`: 45 tests passed.
- `npm run build`: passed (Vite emitted its existing >500 kB bundle-size advisory).
- Targeted ESLint on changed JavaScript/JSX files: passed after the lifecycle effect adjustment.
- Browser check opened `/today` at `http://localhost:5173/today` and confirmed the existing local Today experience renders. The available browser context had no active authenticated Winter Arc session (it rendered local mode), so the account-specific cloud display, refresh/logout/relogin roundtrip, and production localStorage preservation could not be manually verified in that browser context. No login credentials were entered and no ritual was changed.

## Deferred

History, Journey, ritual pages, analysis, reflections, custom-habit editing, cross-device synchronization, and cloud writes remain disconnected. The browser account roundtrip should be manually repeated in the user's already-authenticated browser context before proceeding to a write phase.
