# Phase 13C-5 — Local migration foundation

## Source shape found in the current code

`src/data/storage.js` uses `winterArc.progress.v1`. The serialized version-1 object contains:

- `version`, `startDate`
- `entries[date][ritualId]` with `completed`, `value`, `completedAt`, and sunscreen-only `applicationTimes`
- `customHabits[]` with `id`, `title`, `type`, `unit`, `goal`, `icon`, `theme`, `shortDescription`, `createdAt`, `archived`, and `order`
- `ritualSnapshots[date][]` containing the full date-specific ritual definitions
- `weeklyReflections[weekStart]` with `wins`, `challenges`, `focus`
- `monthlyReflections[monthStart]` with `intention`

The architecture document's top-level shape matches the current implementation. One important limitation in the actual local model: there is no separate `customHabitDefinitions` history collection. It stores the current custom-habit definition and the historical snapshots that exist for individual dates. The transformer maps that current definition to cloud version 1 using its saved `createdAt`; it does not fabricate additional edits. Dated snapshots are copied as-is and remain the historical definition source. Review this limitation if custom-habit editing is introduced before import.

The migration reads the raw string at the storage key directly. It does not call `loadProgress()`, which can normalize/default data and initialize a missing key. Thus preview and validation never rewrite the source record.

## Validation and normalization

`validateLocalData()` distinguishes `valid`, `safely_normalizable`, and `invalid` results. It rejects unsupported versions, malformed JSON/containers, impossible dates, malformed timestamps, unknown root/entry/custom/reflection fields, duplicate custom/snapshot IDs, invalid values/types/goals, unidentified ritual IDs, invalid sunscreen timestamp arrays, and completion metadata that would violate Sleep Tracker's informational constraint. Unmapped fields are errors rather than silently discarded.

Only absent containers and documented optional fields receive safe defaults matching the existing storage normalizer; each default is reported as a warning. The validator clones/parses input before normalizing and never mutates the original storage string. It does not recalculate historical status or apply future product rules.

## Preview, backup, and state

`createMigrationPreview()` returns aggregate counts, validation warnings/errors, whether a Supabase authenticated user ID is present, and a read-only check for existing cloud programs. It does not return the user's email or token. `backupLocalData()` copies the exact serialized local value to `winterArc.progress.v1.migration-backup.v1`; it never clears/overwrites the source, and refuses to replace a different prior backup.

Migration state is stored separately at `winterArc.migration.v1`: `not_started`, `validating`, `ready`, `importing`, `verified`, or `failed`. It contains no password or token. `verified` is written only after read-back content verification.

## Cloud mapping and repeat safety

The explicit `importToCloud()` boundary validates again, obtains the owner ID from Supabase Auth (`auth.getUser()`), backs up the raw source, checks existing programs, then inserts in FK order. No UI, startup path, or current route calls it. It is not executed in Phase 13C-5.

Program and child row IDs are deterministic namespaced SHA-256-derived UUIDv8 values. The program ID is stable per authenticated owner; child IDs are stable per program/date/ritual or source habit/period. Writes use `ignoreDuplicates` and never update a preexisting matching row. If cloud data exists, import stops unless a matching owner/program/source fingerprint in a prior `importing`/`failed` state proves this is a retry of this foundation's own partial import. Verification compares every expected row and mapped field. Failed partial imports retain local backup/status and can retry without duplicating IDs; content conflicts fail verification rather than being overwritten.

Table mapping:

- `arc_programs`: original `startDate` and source local version.
- `custom_habits` + `custom_habit_definitions`: stable source habit ID, current metadata, archive/order, creation time, and a single version-1 definition.
- `ritual_snapshots`: every existing snapshot, original JSON definition, date, and list position.
- `daily_ritual_entries`: every stored date/ritual record with original completion/value/time. Sleep Tracker is explicitly `informational`; its measured value is retained while it remains non-completing.
- `application_times`: copied as an ordered JSON array for sunscreen only.
- `weekly_reflections` / `monthly_reflections`: original period keys and text.

No rows are generated for missing dates or absent reflections. No ritual completion is recalculated.

## Scope and verification

This phase adds only validation, deterministic transformation, preview, backup/status, and a dormant authenticated cloud import boundary. It does not connect UI data to cloud reads/writes and does not alter routing, ritual logic, or local data behavior. Synthetic tests live in `tests/migration.test.js`; they do not read the user's browser data or contact Supabase.
