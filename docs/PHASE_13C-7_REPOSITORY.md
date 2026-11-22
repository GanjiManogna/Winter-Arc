# Phase 13C-7 — Repository Integration Foundation

## Scope and current behavior

This phase adds a repository boundary only. Existing screens and analysis continue importing the current helpers from `src/data/storage.js`; the factory is not wired into the UI.

**CLOUD-FIRST APPLICATION MODE IS NOT ENABLED IN PHASE 13C-7.** The factory defaults to the local repository. Authentication does not select or activate cloud data. No cloud write or migration is performed by this foundation.

## Current local access paths found in `src/`

| Area | Current entry points | Current path |
| --- | --- | --- |
| Today | `TodayDashboard.jsx` | `getAllRituals`, `getDayNumber`, `getTodayEntries`; refreshes on the existing progress event |
| Ritual pages | `RitualPage.jsx` | `getEntry`, `getRitualById`, `getRitualHistory`, `getRitualStats`, `setRitualComplete`, `upsertRitualEntry` |
| History | `HistoryPage.jsx` | `getDaySnapshot`, `getHistoryOverview`, `getRecordedDates`, `toISODate` |
| Journey/reflections | `JourneyPage.jsx` | `getWeeklyReflection`, `saveWeeklyReflection`, `getMonthlyIntention`, `saveMonthlyIntention`; analysis helpers below also read storage |
| Custom habits | `AddHabitModal.jsx` | `createCustomHabit` |
| Daily analysis | `dailyAnalysis.js` | `getDaySnapshot` and date helpers from storage |
| Weekly analysis | `weeklyAnalysis.js` | `loadProgress` for the start date and `getDaySnapshot` for dated records |
| Monthly analysis | `monthlyAnalysis.js` | `loadProgress`, `getDaySnapshot`, and `getRecordedDates` |
| Storage implementation | `storage.js` | `loadProgress`/`saveProgress` use `winterArc.progress.v1`; all date, entry, snapshot, habit, reflection, and aggregate helpers read or update that object |
| Migration-only access | `migrationService.js`, `controlledImportCore.js`, `migrationBackup.js`, temporary migration pages | Raw source-key reads and exact-source backup. These remain outside the app repository API. |

There are no direct `localStorage` calls in Today, History, Journey, RitualPage, or analysis modules. They use the storage helper layer. `storage.js` is the only normal application implementation of the progress key; migration tooling reads the key directly for validation/backup/integrity checks.

## Repository contract

`src/data/repositories/repositoryContract.js` defines the common methods and a `{ data, error }` result shape:

- `getProgramMetadata()`
- `readDailyEntries(dateISO?)` / `writeDailyEntry(dateISO, ritualId, entry)`
- `readRitualSnapshots(dateISO?)`
- `readCustomHabits()` / `writeCustomHabit(habit)`
- `readCustomHabitDefinitions(customHabitId?)` / `writeCustomHabitDefinition(customHabitId, definition)`
- `readWeeklyReflections(weekStart?)` / `writeWeeklyReflection(weekStart, reflection)`
- `readMonthlyReflections(month?)` / `writeMonthlyReflection(month, reflection)`

Daily entries are normalized to `date`, `ritualId`, `completed`, `value`, `completedAt`, and `applicationTimes`. Snapshots preserve the saved definition and order. Reflection APIs retain the current period keys and text fields; application month keys are `YYYY-MM`, mapped to the database's first-of-month `date` column.

## Local implementation

`src/data/repositories/localRepository.js` wraps existing storage helpers. It continues to use `winterArc.progress.v1`, the current entry derivation and completion behavior, current habit/reflection helpers, and existing top-level schema. It does not rewrite data on reads or introduce a second key/schema.

The local model stores a current custom-habit definition in `customHabits`; historical definitions are represented by the existing dated `ritualSnapshots`. It does not have an independent definition-history collection.

## Cloud implementation

`src/data/cloud/cloudRepository.js` implements the same contract over the existing Supabase tables. It calls `auth.getUser()` to obtain the user identity and scopes reads/writes to the account's program and `user_id`; database RLS remains the security boundary. The repository uses the configured Supabase client, whose only browser key is the public `VITE_SUPABASE_ANON_KEY`. No service-role/admin credential is read or exposed.

The current data model assumes one current program per account; when several exist, `getProgramMetadata()` selects the oldest returned program. A later product phase must define explicit active-program selection before supporting multiple arcs per account.

Cloud definitions are versioned rows; local definitions are the current habit object plus historical snapshots. The API returns a current-compatible definition shape while retaining storage-specific version metadata.

## Selection

`src/data/repositories/repositoryFactory.js` provides `createRepository({ mode })` and `getRepository({ mode })`. The default mode is explicitly `local`; cloud mode is available only when a caller explicitly requests it. No auth listener, login, route, or screen selects cloud mode.

## Intentionally deferred

- Wiring screens or analysis to this factory
- Cloud-first reads/writes, background sync, offline queueing, and conflict handling
- Account switching and multi-program selection
- Migration reruns or cloud writes
- Export/deletion, PWA, and future ritual/product changes

The existing migration modules are not part of the new repository path and were not changed in Phase 13C-7.
