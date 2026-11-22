# Supabase database source of truth

**Execution status:** The repository migration is prepared and structurally reviewed, but it has not been applied to the remote Supabase project. This workspace has no Supabase CLI, PostgreSQL client, Docker, or linked local migration configuration. No remote schema or user data was changed.

`migrations/20261002120000_winter_arc_owned_data.sql` is the initial Winter Arc application schema migration. It is designed to run once against an empty Winter Arc application schema in the existing Supabase project. It creates tables and policies only; it does not seed data, migrate localStorage, or alter Supabase Auth users.

## Ownership

All seven application tables carry `user_id` referencing `auth.users(id)` and enable RLS. Four operation-specific policies on each table bind access to `auth.uid()`. Child records also use composite foreign keys containing both `program_id` and `user_id`; custom-habit references carry the same owner/program tuple. Thus an otherwise valid child ID cannot be attached to another user's program.

- `arc_programs`: account-owned root for Winter Arc state.
- `custom_habits`: stable habit identity and current archive/order values.
- `custom_habit_definitions`: timestamped versions of habit definitions.
- `ritual_snapshots`: one ritual definition/order row per date and ritual, retaining the complete historical definition in JSONB.
- `daily_ritual_entries`: one dated value/completion record per ritual; ordered sunscreen application timestamps are retained in the JSON array on that record.
- `weekly_reflections` and `monthly_reflections`: account-owned period notes.

The `informational` record kind has a database check that prevents a completed state or `completed_at`, keeping Sleep Tracker informational. Local calendar dates use PostgreSQL `date`; instants use `timestamptz`.

## Sync reservation (Phase 13D)

`created_at`, `updated_at`, and `revision` are reserved metadata. This migration does not add triggers, outbox tables, device records, realtime publications, or conflict semantics. Future sync must explicitly increment/check revisions and define deterministic conflict handling. Historical snapshot rows are date-specific and should not be rewritten from the current ritual catalog.

## Application boundary

Future cloud reads should go through `src/data/cloud/cloudRepository.js`. Its `listPrograms()` query intentionally has no client-supplied owner filter and relies on database RLS. No existing page imports this repository; the current application remains localStorage-driven. Do not use service-role credentials from the browser.

## Applying and validating

Apply migrations using the project's linked Supabase CLI/local database workflow after reviewing the SQL. Then test anonymous denial and two-user isolation for SELECT/INSERT/UPDATE/DELETE before connecting UI data. Never use real user progress as test fixtures. Phase 13C-4 does not migrate `winterArc.progress.v1`.
