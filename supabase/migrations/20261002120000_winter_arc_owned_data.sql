-- Winter Arc account-owned data foundation.
-- This migration creates schema only; it does not import localStorage data.
-- `revision` and `updated_at` are reserved for the explicit sync protocol in Phase 13D.
-- No automatic revision trigger is installed, so conflict semantics are not implied.

begin;

create table public.arc_programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  start_date date not null default current_date,
  source_schema_version smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint arc_programs_id_user_id_key unique (id, user_id)
);

create table public.custom_habits (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_habit_id text not null,
  archived boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint custom_habits_program_owner_fkey
    foreign key (program_id, user_id)
    references public.arc_programs (id, user_id) on delete cascade,
  constraint custom_habits_id_program_owner_key unique (id, program_id, user_id),
  constraint custom_habits_source_id_key unique (program_id, user_id, source_habit_id),
  constraint custom_habits_order_nonnegative check (display_order >= 0)
);

create table public.custom_habit_definitions (
  id uuid primary key default gen_random_uuid(),
  custom_habit_id uuid not null,
  program_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version integer not null default 1 check (version > 0),
  effective_from timestamptz not null default now(),
  title text not null check (length(btrim(title)) > 0),
  habit_type text not null check (habit_type in ('boolean', 'measurable')),
  unit text,
  goal numeric,
  icon text not null default '✦',
  theme text not null default 'clarity',
  short_description text not null default '',
  archived boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint custom_habit_definitions_owner_fkey
    foreign key (custom_habit_id, program_id, user_id)
    references public.custom_habits (id, program_id, user_id) on delete cascade,
  constraint custom_habit_definitions_version_key unique (custom_habit_id, version),
  constraint custom_habit_definitions_effective_key unique (custom_habit_id, effective_from),
  constraint custom_habit_definitions_type_fields_check check (
    (habit_type = 'measurable' and unit is not null and goal is not null and goal > 0)
    or (habit_type = 'boolean' and unit is null and goal is null)
  ),
  constraint custom_habit_definitions_order_nonnegative check (display_order >= 0)
);

create table public.ritual_snapshots (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  snapshot_date date not null,
  ritual_id text not null,
  custom_habit_id uuid,
  position integer not null default 0 check (position >= 0),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint ritual_snapshots_program_owner_fkey
    foreign key (program_id, user_id)
    references public.arc_programs (id, user_id) on delete cascade,
  constraint ritual_snapshots_custom_owner_fkey
    foreign key (custom_habit_id, program_id, user_id)
    references public.custom_habits (id, program_id, user_id) on delete cascade,
  constraint ritual_snapshots_date_ritual_key
    unique (program_id, user_id, snapshot_date, ritual_id)
);

create table public.daily_ritual_entries (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_date date not null,
  ritual_id text not null,
  custom_habit_id uuid,
  record_kind text not null check (record_kind in ('boolean', 'measurable', 'informational')),
  completed boolean not null default false,
  value numeric,
  completed_at timestamptz,
  application_times jsonb not null default '[]'::jsonb
    check (jsonb_typeof(application_times) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint daily_ritual_entries_program_owner_fkey
    foreign key (program_id, user_id)
    references public.arc_programs (id, user_id) on delete cascade,
  constraint daily_ritual_entries_custom_owner_fkey
    foreign key (custom_habit_id, program_id, user_id)
    references public.custom_habits (id, program_id, user_id) on delete cascade,
  constraint daily_ritual_entries_date_ritual_key
    unique (program_id, user_id, entry_date, ritual_id),
  constraint daily_ritual_entries_informational_not_complete_check
    check (record_kind <> 'informational' or (not completed and completed_at is null)),
  constraint daily_ritual_entries_application_ritual_check
    check (ritual_id = 'sunscreen' or application_times = '[]'::jsonb)
);

create table public.weekly_reflections (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week_start date not null,
  wins text not null default '',
  challenges text not null default '',
  focus text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint weekly_reflections_program_owner_fkey
    foreign key (program_id, user_id)
    references public.arc_programs (id, user_id) on delete cascade,
  constraint weekly_reflections_period_key unique (program_id, user_id, week_start)
);

create table public.monthly_reflections (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  intention text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint monthly_reflections_program_owner_fkey
    foreign key (program_id, user_id)
    references public.arc_programs (id, user_id) on delete cascade,
  constraint monthly_reflections_period_key unique (program_id, user_id, month)
);

create index arc_programs_user_created_idx
  on public.arc_programs (user_id, created_at desc);
create index custom_habits_program_order_idx
  on public.custom_habits (program_id, user_id, display_order);
create index custom_habit_definitions_effective_idx
  on public.custom_habit_definitions (custom_habit_id, effective_from desc);
create index ritual_snapshots_user_date_idx
  on public.ritual_snapshots (user_id, snapshot_date desc);
create index daily_ritual_entries_user_date_idx
  on public.daily_ritual_entries (user_id, entry_date desc);
create index daily_ritual_entries_custom_habit_idx
  on public.daily_ritual_entries (custom_habit_id, entry_date desc)
  where custom_habit_id is not null;
create index weekly_reflections_user_period_idx
  on public.weekly_reflections (user_id, week_start desc);
create index monthly_reflections_user_period_idx
  on public.monthly_reflections (user_id, month desc);

alter table public.arc_programs enable row level security;
alter table public.custom_habits enable row level security;
alter table public.custom_habit_definitions enable row level security;
alter table public.ritual_snapshots enable row level security;
alter table public.daily_ritual_entries enable row level security;
alter table public.weekly_reflections enable row level security;
alter table public.monthly_reflections enable row level security;

-- Every policy checks auth.uid(); child ownership is also constrained by composite FKs.
create policy arc_programs_select_own on public.arc_programs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy arc_programs_insert_own on public.arc_programs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy arc_programs_update_own on public.arc_programs
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy arc_programs_delete_own on public.arc_programs
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy custom_habits_select_own on public.custom_habits
  for select to authenticated using ((select auth.uid()) = user_id);
create policy custom_habits_insert_own on public.custom_habits
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy custom_habits_update_own on public.custom_habits
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy custom_habits_delete_own on public.custom_habits
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy custom_habit_definitions_select_own on public.custom_habit_definitions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy custom_habit_definitions_insert_own on public.custom_habit_definitions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy custom_habit_definitions_update_own on public.custom_habit_definitions
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy custom_habit_definitions_delete_own on public.custom_habit_definitions
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy ritual_snapshots_select_own on public.ritual_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);
create policy ritual_snapshots_insert_own on public.ritual_snapshots
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy ritual_snapshots_update_own on public.ritual_snapshots
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy ritual_snapshots_delete_own on public.ritual_snapshots
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy daily_ritual_entries_select_own on public.daily_ritual_entries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy daily_ritual_entries_insert_own on public.daily_ritual_entries
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy daily_ritual_entries_update_own on public.daily_ritual_entries
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy daily_ritual_entries_delete_own on public.daily_ritual_entries
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy weekly_reflections_select_own on public.weekly_reflections
  for select to authenticated using ((select auth.uid()) = user_id);
create policy weekly_reflections_insert_own on public.weekly_reflections
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy weekly_reflections_update_own on public.weekly_reflections
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy weekly_reflections_delete_own on public.weekly_reflections
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy monthly_reflections_select_own on public.monthly_reflections
  for select to authenticated using ((select auth.uid()) = user_id);
create policy monthly_reflections_insert_own on public.monthly_reflections
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy monthly_reflections_update_own on public.monthly_reflections
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy monthly_reflections_delete_own on public.monthly_reflections
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table
  public.arc_programs,
  public.custom_habits,
  public.custom_habit_definitions,
  public.ritual_snapshots,
  public.daily_ritual_entries,
  public.weekly_reflections,
  public.monthly_reflections
from public, anon;

grant select, insert, update, delete on table
  public.arc_programs,
  public.custom_habits,
  public.custom_habit_definitions,
  public.ritual_snapshots,
  public.daily_ritual_entries,
  public.weekly_reflections,
  public.monthly_reflections
to authenticated;

comment on table public.arc_programs is
  'Account-owned Winter Arc program. start_date is a calendar date; revision fields are reserved for Phase 13D sync.';
comment on table public.custom_habits is
  'Stable custom-habit identity and current archive/order state; source_habit_id preserves the local identifier during a future import.';
comment on table public.custom_habit_definitions is
  'Versioned custom-habit definitions; historical ritual snapshots remain the date-specific display source.';
comment on table public.ritual_snapshots is
  'Date-specific ritual definitions and order; custom_habit_id links custom definitions without replacing the historical payload.';
comment on table public.daily_ritual_entries is
  'Dated ritual values and completion state. Informational records such as Sleep Tracker are constrained to remain non-completing.';
comment on column public.daily_ritual_entries.application_times is
  'Ordered JSON array of sunscreen application timestamps for this ritual/date entry; remains empty for other rituals.';

commit;
