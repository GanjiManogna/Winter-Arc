# Phase 13C-8A — Cloud-first Account Data Loading Foundation

## Scope

This phase adds a read-only path to load one authenticated user's existing Winter Arc cloud records and reconstruct the application progress object. It does not connect this path to Today, History, Journey, or ritual UI. The repository factory still defaults to local storage; authentication does not switch the application data source.

No program is created when the account has none. Local progress is neither read as an automatic fallback nor overwritten by this service.

## What was added

- `cloudRepository.loadProgress()` reads the authenticated user's program and its six associated record collections.
- `reconstructCloudProgress()` validates and maps database rows to the current app data model.
- `loadAccountProgress()` consults the existing auth service and reports `loading`, `unauthenticated`, `no-cloud-program`, `loaded`, or `cloud-load-error` through its result and optional state callback.
- The existing repository contract and local repository both include `loadProgress()`. The factory remains explicitly local by default.

## Mapping to the application model

| Cloud records | Application model |
| --- | --- |
| `arc_programs.start_date` and `source_schema_version` | `startDate` and `version` |
| `daily_ritual_entries` | `entries[entry_date][ritual_id]`, preserving completion, numeric value, timestamp, and ordered sunscreen `application_times` |
| `ritual_snapshots` | `ritualSnapshots[snapshot_date]`, sorted by saved `position` and retaining the stored `definition` JSON |
| `custom_habits` + latest `custom_habit_definitions` row | Current `customHabits`, including source ID, definition, creation date, archive state, and display order |
| `weekly_reflections` | `weeklyReflections[week_start]` |
| `monthly_reflections` | `monthlyReflections[YYYY-MM]` from the database's first-of-month date |

No absent days or records are created. Invalid dates, duplicate or incomplete rows, invalid custom-habit definitions, and completed informational/Sleep Tracker rows produce a safe load error instead of a partial or silently corrected model. Sleep Tracker values remain informational and non-completing.

## Ownership and security

The service obtains the session using `authService.getCurrentSession()` and accepts no owner ID argument. The cloud repository independently calls Supabase `auth.getUser()` and derives the program owner from that authenticated identity. Program and child-record reads include account/program filters, with RLS remaining the security boundary. Errors are reduced to safe codes/messages. No session tokens, credentials, or payloads are logged or returned as service metadata.

## No-program and local fallback behavior

An authenticated account with no program returns `no-cloud-program`; this path does not create a program. A signed-out account returns `unauthenticated` without issuing cloud data queries. Cloud read failures do not trigger local writes or an automatic local/cloud merge.

The local repository remains the factory default and continues using `winterArc.progress.v1`. The loading service is not wired into existing screens in 13C-8A.

## Verification

Automated tests use a mocked Supabase client and synthetic records. They cover successful account loading, no-program and unauthenticated states, all model mappings, sunscreen timestamps, Sleep Tracker behavior, snapshots, custom habits, reflections, load errors, malformed/incomplete rows, and the loading state callback.

No production Supabase rows were written or changed. No localStorage data was read or changed by the automated cloud-loading tests. The existing migration/import code was not run or modified.

## Deferred for 13C-8B

Before wiring screens, define account data lifecycle and loading/error presentation for the UI, decide how no-cloud-program accounts use local data, and handle account changes while a load is in flight. Cloud-first application mode remains disabled until that work is reviewed.
