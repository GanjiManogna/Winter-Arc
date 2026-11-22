-- Private Friends Challenge v1. Challenge members receive names and aggregate
-- completion percentages only; personal ritual rows remain owner-scoped.
begin;

create schema if not exists private;

create table public.winter_arc_challenges (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{12,24}$'),
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint winter_arc_challenges_valid_dates check (end_date > start_date),
  constraint winter_arc_challenges_ended_state check (
    (status = 'active' and ended_at is null)
    or (status = 'ended' and ended_at is not null)
  )
);

create table public.winter_arc_challenge_members (
  challenge_id uuid not null references public.winter_arc_challenges (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  role text not null check (role in ('owner', 'member')),
  primary key (challenge_id, user_id)
);

create unique index winter_arc_challenge_one_owner_idx
  on public.winter_arc_challenge_members (challenge_id) where role = 'owner';
create index winter_arc_challenge_members_user_idx
  on public.winter_arc_challenge_members (user_id, joined_at desc);
alter table public.winter_arc_challenges enable row level security;
alter table public.winter_arc_challenge_members enable row level security;

-- Direct table access is intentionally unavailable. RLS policies remain as a
-- defense-in-depth boundary if table grants are ever introduced later; the
-- SECURITY DEFINER RPCs below check membership and return minimized results.
create policy winter_arc_challenges_select_member
  on public.winter_arc_challenges for select to authenticated
  using (exists (
    select 1 from public.winter_arc_challenge_members m
    where m.challenge_id = id and m.user_id = (select auth.uid())
  ));
create policy winter_arc_challenges_select_owner
  on public.winter_arc_challenges for select to authenticated
  using (owner_id = (select auth.uid()));
create policy winter_arc_challenges_insert_owner
  on public.winter_arc_challenges for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy winter_arc_challenges_update_owner
  on public.winter_arc_challenges for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy winter_arc_challenge_members_select_self
  on public.winter_arc_challenge_members for select to authenticated
  using (user_id = (select auth.uid()));
create policy winter_arc_challenge_members_insert_owner
  on public.winter_arc_challenge_members for insert to authenticated
  with check (
    user_id = (select auth.uid()) and role = 'owner'
    and exists (
      select 1 from public.winter_arc_challenges c
      where c.id = challenge_id and c.owner_id = (select auth.uid())
    )
  );
create policy winter_arc_challenge_members_delete_self
  on public.winter_arc_challenge_members for delete to authenticated
  using (user_id = (select auth.uid()) and role = 'member');

revoke all on table public.winter_arc_challenges, public.winter_arc_challenge_members
  from public, anon, authenticated;

create or replace function private.winter_arc_challenge_member_progress(
  p_challenge_id uuid,
  p_user_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.winter_arc_challenges%rowtype;
  v_program_id uuid;
  v_first_day date;
  v_last_day date;
  v_possible bigint := 0;
  v_completed bigint := 0;
  v_core_rituals text[] := array[
    'wake', 'sunscreen', 'water', 'steps', 'workout', 'food',
    'no-junk-food', 'learn', 'meditate', 'sleep', 'skincare'
  ];
begin
  select * into v_challenge
  from public.winter_arc_challenges c
  where c.id = p_challenge_id;
  if not found then return 0; end if;

  select p.id into v_program_id
  from public.arc_programs p
  where p.user_id = p_user_id
  order by p.created_at asc
  limit 1;

  v_first_day := v_challenge.start_date;
  v_last_day := least(v_challenge.end_date, current_date);
  if v_last_day < v_first_day then return 0; end if;

  -- Core ritual set mirrors the app's built-in rituals. Sleep Tracker is
  -- informational and custom habits are deliberately excluded. Skincare was
  -- introduced on 2026-10-02 and is not counted before its effective date.
  v_possible := (v_last_day - v_first_day + 1)::bigint
    * cardinality(array_remove(v_core_rituals, 'skincare'));
  if v_last_day >= date '2026-10-02' then
    v_possible := v_possible + (v_last_day - greatest(v_first_day, date '2026-10-02') + 1);
  end if;

  select count(*) into v_completed
  from public.daily_ritual_entries e
  where e.user_id = p_user_id
    and e.program_id = v_program_id
    and e.entry_date between v_first_day and v_last_day
    and e.custom_habit_id is null
    and e.ritual_id = any(v_core_rituals)
    and e.record_kind in ('boolean', 'measurable')
    and e.completed is true;

  if v_possible = 0 then return 0; end if;
  return least(100, round((v_completed::numeric / v_possible) * 100)::integer);
end;
$$;

revoke all on function private.winter_arc_challenge_member_progress(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.winter_arc_challenge_create(
  p_name text,
  p_start_date date,
  p_end_date date,
  p_invite_code text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_challenge_id uuid;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_name is null or length(btrim(p_name)) not between 2 and 80 then
    raise exception 'INVALID_NAME';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date <= p_start_date then
    raise exception 'INVALID_DATE_RANGE';
  end if;
  if p_invite_code is null or p_invite_code !~ '^[A-Z0-9]{12,24}$' then
    raise exception 'INVALID_INVITE_CODE';
  end if;

  insert into public.winter_arc_challenges (name, owner_id, start_date, end_date, invite_code)
  values (btrim(p_name), v_user_id, p_start_date, p_end_date, p_invite_code)
  returning id into v_challenge_id;

  insert into public.winter_arc_challenge_members (challenge_id, user_id, role)
  values (v_challenge_id, v_user_id, 'owner');
  return v_challenge_id;
end;
$$;

create or replace function public.winter_arc_challenge_list_mine()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'start_date', c.start_date,
      'end_date', c.end_date,
      'status', case when c.status = 'ended' or c.end_date < current_date then 'ended' else 'active' end,
      'role', m.role,
      'member_count', (select count(*) from public.winter_arc_challenge_members cm where cm.challenge_id = c.id)
    ) order by c.created_at desc)
    from public.winter_arc_challenges c
    join public.winter_arc_challenge_members m on m.challenge_id = c.id
    where m.user_id = v_user_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.winter_arc_challenge_preview_invite(p_invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_challenge public.winter_arc_challenges%rowtype;
  v_owner_name text;
  v_member_count integer;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_challenge
  from public.winter_arc_challenges c
  where c.invite_code = upper(btrim(coalesce(p_invite_code, '')));
  if not found then raise exception 'INVALID_INVITE'; end if;
  if v_challenge.status = 'ended' or v_challenge.end_date < current_date then
    raise exception 'CHALLENGE_ENDED';
  end if;

  select nullif(btrim(u.raw_user_meta_data ->> 'display_name'), '') into v_owner_name
  from auth.users u where u.id = v_challenge.owner_id;
  select count(*)::integer into v_member_count
  from public.winter_arc_challenge_members m where m.challenge_id = v_challenge.id;
  return jsonb_build_object(
    'id', v_challenge.id,
    'name', v_challenge.name,
    'start_date', v_challenge.start_date,
    'end_date', v_challenge.end_date,
    'owner_name', coalesce(v_owner_name, 'Winter Arc Member'),
    'member_count', v_member_count,
    'status', 'active',
    'already_member', exists (
      select 1 from public.winter_arc_challenge_members m
      where m.challenge_id = v_challenge.id and m.user_id = v_user_id
    )
  );
end;
$$;

create or replace function public.winter_arc_challenge_join(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_challenge public.winter_arc_challenges%rowtype;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_challenge
  from public.winter_arc_challenges c
  where c.invite_code = upper(btrim(coalesce(p_invite_code, '')))
  for update;
  if not found then raise exception 'INVALID_INVITE'; end if;
  if v_challenge.status = 'ended' or v_challenge.end_date < current_date then
    raise exception 'CHALLENGE_ENDED';
  end if;
  if exists (
    select 1 from public.winter_arc_challenge_members m
    where m.challenge_id = v_challenge.id and m.user_id = v_user_id
  ) then raise exception 'ALREADY_MEMBER'; end if;

  insert into public.winter_arc_challenge_members (challenge_id, user_id, role)
  values (v_challenge.id, v_user_id, 'member');
  return v_challenge.id;
end;
$$;

create or replace function public.winter_arc_challenge_read(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_challenge public.winter_arc_challenges%rowtype;
  v_owner_name text;
  v_members jsonb;
  v_today date := current_date;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.winter_arc_challenge_members m
    where m.challenge_id = p_challenge_id and m.user_id = v_user_id
  ) then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  select * into v_challenge from public.winter_arc_challenges c where c.id = p_challenge_id;
  if not found then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  select nullif(btrim(u.raw_user_meta_data ->> 'display_name'), '') into v_owner_name
  from auth.users u where u.id = v_challenge.owner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'display_name', coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), 'Winter Arc Member'),
    'role', m.role,
    'progress_percent', private.winter_arc_challenge_member_progress(v_challenge.id, m.user_id)
  ) order by private.winter_arc_challenge_member_progress(v_challenge.id, m.user_id) desc,
    coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), 'Winter Arc Member') asc), '[]'::jsonb)
  into v_members
  from public.winter_arc_challenge_members m
  left join auth.users u on u.id = m.user_id
  where m.challenge_id = v_challenge.id;

  return jsonb_build_object(
    'id', v_challenge.id,
    'name', v_challenge.name,
    'start_date', v_challenge.start_date,
    'end_date', v_challenge.end_date,
    'status', case when v_challenge.status = 'ended' or v_challenge.end_date < v_today then 'ended' else 'active' end,
    'invite_code', v_challenge.invite_code,
    'owner_name', coalesce(v_owner_name, 'Winter Arc Member'),
    'owner', v_challenge.owner_id = v_user_id,
    'member_count', jsonb_array_length(v_members),
    'challenge_day', greatest(0, least(v_challenge.end_date - v_challenge.start_date + 1, v_today - v_challenge.start_date + 1)),
    'total_days', v_challenge.end_date - v_challenge.start_date + 1,
    'members', v_members
  );
end;
$$;

create or replace function public.winter_arc_challenge_leave(p_challenge_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select m.role into v_role from public.winter_arc_challenge_members m
  where m.challenge_id = p_challenge_id and m.user_id = v_user_id;
  if v_role is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_role = 'owner' then raise exception 'OWNER_MUST_END'; end if;
  delete from public.winter_arc_challenge_members m
  where m.challenge_id = p_challenge_id and m.user_id = v_user_id and m.role = 'member';
  return found;
end;
$$;

create or replace function public.winter_arc_challenge_end(p_challenge_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.winter_arc_challenges c
  set status = 'ended', ended_at = now()
  where c.id = p_challenge_id and c.owner_id = v_user_id and c.status = 'active';
  if found then return true; end if;
  if exists (select 1 from public.winter_arc_challenges c where c.id = p_challenge_id and c.owner_id = v_user_id) then
    return false;
  end if;
  raise exception 'CHALLENGE_NOT_FOUND';
end;
$$;

revoke all on function public.winter_arc_challenge_create(text, date, date, text) from public, anon;
revoke all on function public.winter_arc_challenge_list_mine() from public, anon;
revoke all on function public.winter_arc_challenge_preview_invite(text) from public, anon;
revoke all on function public.winter_arc_challenge_join(text) from public, anon;
revoke all on function public.winter_arc_challenge_read(uuid) from public, anon;
revoke all on function public.winter_arc_challenge_leave(uuid) from public, anon;
revoke all on function public.winter_arc_challenge_end(uuid) from public, anon;

grant execute on function public.winter_arc_challenge_create(text, date, date, text) to authenticated;
grant execute on function public.winter_arc_challenge_list_mine() to authenticated;
grant execute on function public.winter_arc_challenge_preview_invite(text) to authenticated;
grant execute on function public.winter_arc_challenge_join(text) to authenticated;
grant execute on function public.winter_arc_challenge_read(uuid) to authenticated;
grant execute on function public.winter_arc_challenge_leave(uuid) to authenticated;
grant execute on function public.winter_arc_challenge_end(uuid) to authenticated;

comment on table public.winter_arc_challenges is
  'Private friend challenges. Members only receive minimized aggregate progress through authenticated RPCs.';
comment on table public.winter_arc_challenge_members is
  'Membership for private Winter Arc challenges; identity is resolved from Supabase Auth metadata.';

commit;
