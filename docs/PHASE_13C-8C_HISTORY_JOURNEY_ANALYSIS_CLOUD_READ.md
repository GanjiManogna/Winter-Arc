# Phase 13C-8C — History, Journey, and Analysis Cloud Read

## Scope and data source

History and Journey (including daily, weekly, and monthly analysis/reflection views) now use the authenticated account's reconstructed cloud progress when the shared 13C-8B account lifecycle reports a successful load. No other page was connected. The repository factory remains local by default.

The existing lifecycle states remain distinct. Loading hides page data; signed-out mode uses the existing local experience; no-program and cloud-load-error modes fall back to local progress and show the shared calm notice, with retry on errors. No program is created and no data is merged.

## Lifecycle and account switching

Pages reuse `AuthProvider`, `useAccountDataLifecycle`, and `accountProgressService`. The service verifies that the current Supabase session still matches the AuthProvider identity before reading. The lifecycle controller clears prior account progress before loading a changed identity and rejects stale responses. Page-local navigation/draft state is keyed by the current identity so it is reset across account changes.

## Historical snapshots and analysis

The progress-aware calculation functions consume a supplied progress model without accessing `localStorage`. Existing local APIs remain wrappers around the same calculations, preserving signed-out behavior and formulas.

- History uses stored `ritualSnapshots[date]` definitions when present; it does not substitute today's ritual catalog for historical dates. It retains date order, completion counts, measurable values, completion timestamps, sunscreen application times, custom-habit records, and informational Sleep Tracker values.
- Journey's daily, weekly, and monthly calculations use the same data model and existing formulas. Arc-aligned weeks, month eligibility boundaries, recorded-day behavior, generated analysis copy, custom-habit patterns, and reflection keys are preserved.
- Sleep Tracker remains informational and excluded from completion denominators. Its measured values continue to feed historical sleep summaries.
- Weekly wins/challenges/focus and the monthly intention come from the reconstructed cloud reflection maps.

## Read-only restrictions

Cloud-mode History is view-only. Journey's weekly and monthly reflection fields are marked read-only; page navigation does not save them. All reflection persistence paths pass through `saveReflectionForMode`, which blocks saves in cloud-read-only mode. Local mode continues to use the existing reflection persistence functions. No Supabase write method is called by these pages, and no schema or migration work was performed.

The cloud progress path calls only the existing repository load operation. Synthetic tests verify the read path has no repository writes. The progress-aware History and analysis functions are tested with a storage sentinel and make no localStorage reads or writes.

## Validation

- `npm test`: 49 passed, 0 failed.
- `npm run build`: passed. Vite reports the existing advisory that the main minified bundle exceeds 500 kB.
- Targeted ESLint on all changed JavaScript/JSX files: passed with no output.
- Full `npm run lint`: still reports the known unrelated `src/components/CustomHabitModal.jsx:20` `react-hooks/set-state-in-effect` error. That file was not changed.
- Browser fallback check: `/history` and `/journey` rendered their existing empty/local states at `localhost:5173` in the available browser context.

## Manual verification limitation

The available browser context did not have an active authenticated Winter Arc session, so the account-specific cloud display and refresh/logout/relogin sequence could not be manually verified there. User A-to-User B display separation is covered with synthetic lifecycle tests, including delayed out-of-order responses, but was not exercised with two real accounts. No ritual or reflection writes, Supabase writes, migrations, or schema changes were performed.
