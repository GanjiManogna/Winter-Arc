# Phase 13B — Architecture Decision

**Status:** Decisions locked for Phase 13C planning. This document describes the architecture; it does not add authentication, cloud integration, schema migrations, or synchronization code.

## 1. Architecture overview

Winter Arc remains a React/Vite single-page web app and its first mobile target is an installable PWA. React Router continues to own client-side navigation. Existing components continue to use the current storage helpers until a later phase introduces a repository boundary. Supabase Auth supplies account identity; Supabase PostgreSQL stores account-owned cloud data. PostgreSQL Row Level Security (RLS) is mandatory for every user-owned table.

The intended boundary is:

```text
React pages/components
        ↓
Winter Arc data/repository interface (introduced in a later phase)
        ├── local data/cache + pending local changes
        └── Supabase adapter (authenticated cloud reads/writes)
```

The application’s current local model remains the conceptual source of truth for the domain. Cloud persistence may use relational rows while preserving historical dates, definitions, and values.

## 2. Why Supabase

Supabase is the selected backend because it provides email/password authentication, PostgreSQL, and RLS in one service. A relational model suits dated ritual entries, versioned custom-habit definitions, snapshots, and reflections. It also leaves SQL and PostgreSQL tooling available for export and future server-side features. Provider-specific access should remain behind a data/repository boundary so UI components do not depend directly on Supabase APIs.

## 3. Authentication architecture

- Initial provider: Supabase Auth email + password.
- Google sign-in is a later provider addition; account identity is the stable Supabase user UUID, not the email or provider.
- Auth state will be resolved before loading account-scoped cloud data. Signed-out behavior remains local until the product defines its exact import prompt.
- Supabase client configuration may contain the project URL and publishable/anon key, which are public client identifiers. It must never contain a service-role key, database password, or other privileged secret. `VITE_*` values are bundled into client code and are not secret storage.
- Provider-specific auth and persistence behavior belongs in an auth adapter/service, not in ritual components.

## 4. Database ownership model

Supabase Auth owns identity in `auth.users`. Each Winter Arc program and all descendant rows are owned by that UUID. User-owned tables should carry `user_id uuid not null references auth.users(id)` and have RLS enabled. Policies must require `auth.uid() = user_id` for reads and writes. Child rows must also be constrained to a parent program belonging to that same user; use composite foreign keys or equivalent database constraints in addition to RLS.

Never treat a user ID supplied by the browser as proof of ownership. The authenticated JWT and database policies enforce ownership on the server.

## 5. Proposed database/data boundaries

This is a proposed initial relational shape, not executable migration SQL:

| Table | Main fields and purpose | Ownership |
|---|---|---|
| `arc_programs` | `id`, `user_id`, `start_date`, `source_schema_version`, timestamps; one or more named Winter Arc programs per account if product later permits them | `user_id = auth.uid()`; all children reference the same owner/program pair |
| `daily_ritual_entries` | `program_id`, `user_id`, `entry_date`, `ritual_id`, `completed`, `value` (numeric where applicable), `completed_at`, `application_times` (ordered JSONB array of ISO timestamps), sync metadata; unique `(program_id, entry_date, ritual_id)` | Owner policy plus composite FK to `arc_programs(id,user_id)` |
| `ritual_snapshots` | `program_id`, `user_id`, `snapshot_date`, `ritual_id`, `position`, `definition` JSONB; unique `(program_id,snapshot_date,ritual_id)`. Stores the definition and ordering as they applied on that date, including static and custom rituals | Owner policy plus composite FK to `arc_programs` |
| `custom_habits` | Stable custom-habit ID, `program_id`, `user_id`, creation timestamp, current archived/order state | Owner policy plus composite FK to `arc_programs` |
| `custom_habit_definitions` | `custom_habit_id`, `program_id`, `user_id`, `effective_from`, definition fields/JSONB (title, type, unit, goal, icon, theme, description); supports historical definition changes without rewriting past snapshots | Owner policy plus same-owner parent constraints |
| `weekly_reflections` | `program_id`, `user_id`, `week_start`, `wins`, `challenges`, `focus`; unique `(program_id,week_start)` | Owner policy plus composite FK to `arc_programs` |
| `monthly_reflections` | `program_id`, `user_id`, `month`, `intention`; unique `(program_id,month)` | Owner policy plus composite FK to `arc_programs` |
| `sync_conflicts` (optional when sync is introduced) | Record IDs, base/local/cloud revisions, conflict state and resolution metadata; do not store unnecessary duplicate personal content | Owner policy; program and user must agree |

Use a composite unique key on `arc_programs(id,user_id)` so child composite foreign keys can enforce that the row owner and program owner agree. RLS must cover `SELECT`, `INSERT`, `UPDATE`, and `DELETE`; policies should also validate parent ownership. Database constraints and policies should be tested against two distinct users before launch.

Keep `application_times` ordered and lossless. Do not collapse sunscreen reapplications to a boolean. Snapshot rows preserve ritual definitions as of each date, while custom-habit definition rows retain the evolution of custom habits. A snapshot should not be regenerated from today’s ritual catalog during import.

## 6. Local storage responsibilities

The current `winterArc.progress.v1` record remains untouched during 13B. In the eventual offline-capable design, local persistence/cache is responsible for immediate reads and writes, a per-account partition (including a distinct signed-out/local-only partition), and a durable pending-change queue. Pending writes should include explicit record identity and sync metadata. The existing single global key cannot safely serve multiple accounts after account switching without a scoped cache/partition design.

Do not delete the original key after import merely because an upload request succeeded. Retain a recoverable copy until the server data has been verified and the migration is marked complete.

## 7. Cloud storage responsibilities

PostgreSQL is authoritative for synchronized account data and server-enforced ownership. It stores the program start date, daily values/completion state/timestamps, date-specific ritual snapshots, custom-habit identity and definitions, and weekly/monthly reflections. The client cache supports offline interaction but does not authorize access or decide ownership.

## 8. Migration strategy

Migration will be a later, explicit, idempotent import from `winterArc.progress.v1`:

1. Read and preserve the existing JSON object without mutating it; validate its shape and record the source schema version.
2. Convert `startDate` to `arc_programs`; convert each `entries[date][ritualId]` to a daily entry, retaining `completed`, `value`, and `completedAt`; move sunscreen `applicationTimes` intact and in order.
3. Convert each `ritualSnapshots[date]` definition to snapshot rows without substituting current definitions. Convert custom habit records to stable habit IDs and definition records; preserve archived/order state and derive historical visibility from saved snapshots and entry dates rather than rewriting history.
4. Convert weekly and monthly reflection maps to one row per period.
5. Use an import ID/idempotency marker scoped to the authenticated user and source version. Make retries safe; do not create duplicate programs or rows.
6. Verify imported dates, record counts, custom habits, snapshots, reflection periods, and timestamp/value fidelity. Mark migration complete only after verification; keep the source copy until then.

If both local and cloud data exist, do not silently overwrite either side. Present or apply a documented merge decision after comparing records. Historical snapshots are immutable migration inputs; conflicts must not rewrite them without an explicit resolution.

## 9. Offline strategy

The PWA should continue to serve the app shell when available offline and read/write local cached data. Cloud operations wait until connectivity returns. Offline changes must be durable and visibly pending; failed or rejected changes must remain recoverable. A service worker/app-shell cache and IndexedDB-backed pending queue are likely future tools, but neither is added in 13B. Browser storage eviction and device loss remain risks until sync succeeds; the UI should eventually communicate sync state.

## 10. Sync strategy

Use an explicit local outbox and deterministic server acknowledgements. Each changed record needs a stable ID, owner/program scope, `updated_at`, a monotonic or server-checked `revision`/base revision, and sync state such as `pending`, `synced`, or `conflict`. Deletions require tombstones until all relevant clients have observed them. A device/install ID may help diagnose origin but cannot replace account ownership.

Sync should upload pending changes, validate ownership and expected revision server-side, then acknowledge and update the local base revision. It should retry safely and be idempotent. This is a target design only; no sync engine is included here.

## 11. Conflict-resolution requirements

The current model has no generic update timestamp or revision, so it cannot safely infer which of two offline edits is newer. Do not claim conflict resolution through silent last-write-wins. Before sync implementation, define conflict behavior by data type: for example, independent date/ritual records may merge when they do not collide; concurrent edits to the same entry or reflection need a deterministic compare/resolution path that preserves both values until resolved. Snapshots should be immutable historical records. No conflict policy should silently discard local or cloud changes.

## 12. Account-switching behavior

- **First sign-in:** Identify the currently active local-only dataset; ask whether to import it into the new account. Never upload it without explicit account association. If the account already has cloud data, use the defined merge flow.
- **Returning sign-in:** Load only that authenticated user’s program and that user’s local cache; reconcile pending changes for that same account.
- **Sign-out:** Stop cloud requests, clear in-memory account data, and retain pending changes only in the signed-out/local partition or the originating account’s isolated partition. Do not make one account’s pending queue available for another account.
- **Account switch:** Complete sign-out isolation first, then authenticate the next identity and load only its cache/cloud rows. Require an explicit migration/import choice before moving a local-only dataset between identities.
- **Offline:** Continue with the active account’s cached data; do not switch the pending queue’s owner. If identity cannot be established, do not perform authenticated sync.
- **Reconnect:** Sync only the active account’s queue; validate ownership and revisions, acknowledge safe changes, and surface unresolved conflicts without discarding either version.

## 13. Security/RLS requirements

- Enable RLS on every user-owned table and default to deny until policies exist.
- Require `auth.uid() = user_id` for owner reads/writes; verify inserts and updates cannot change ownership.
- Enforce that child `program_id` belongs to the same `user_id` with database constraints as well as RLS.
- Keep service-role keys and database credentials on trusted server-side infrastructure only; never bundle them in Vite variables or browser code.
- Validate values and payload size at the data boundary. Treat local data as untrusted input.
- Test cross-account select/insert/update/delete attempts and account switching before release.
- Define secure account deletion and data export when those features are implemented.

## 14. Future PWA/mobile/widget direction

The first mobile deliverable is an installable web PWA using the current React/Vite app. A later phase can add a web manifest, icons, service worker/app-shell caching, and install/offline verification. Push reminders require explicit permission and server-side delivery design. Home-screen widgets and native packaging are later platform decisions; keep domain/data APIs independent of browser components so a native client can reuse the same account-owned data contract. Do not migrate this app to React Native as part of 13B.

## 15. Phase 13C implementation plan

Phase 13C should implement the smallest secure account foundation in staged steps:

1. Create the Supabase project and environment-secret handling; document which client values are public.
2. Write and review executable PostgreSQL migrations, constraints, indexes, and RLS policies for the agreed schema; test isolation with two users before connecting the UI.
3. Add a thin Supabase client/auth service and email/password auth state, without moving ritual storage yet.
4. Define repository interfaces around current storage operations so pages remain decoupled from Supabase.
5. Implement the one-time import only after schema/RLS tests and merge decisions are approved; preserve the local source and verify imported data.

Do not combine initial login with an unreviewed full sync engine. Offline queueing, conflict resolution, PWA installation, Google sign-in, reminders, export/deletion, and native packaging remain later work.

## Current-code reference

The actual current store is `winterArc.progress.v1` in `src/data/storage.js`. It contains `version`, `startDate`, `entries`, `customHabits`, `ritualSnapshots`, `weeklyReflections`, and `monthlyReflections`. Entry records contain `completed`, `value`, and `completedAt`; sunscreen can additionally contain `applicationTimes`. Custom habits contain ID, title, type, unit, goal, icon, theme, short description, creation date, archived flag, and order. `saveProgress()` writes the whole JSON object and dispatches `winter-arc-progress`. Current loading normalizes defaults and returns version 1; there is no versioned migration mechanism, account partition, backend, or sync metadata. `src/data/rituals.js` defines built-in rituals and `src/data/ritualStatus.js` derives status from entries. No existing data or behavior is changed by this decision document.
