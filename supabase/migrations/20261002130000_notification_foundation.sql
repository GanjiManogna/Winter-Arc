-- Notification opt-in foundation. No delivery queue or scheduling is created.
begin;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null check (length(p256dh) between 20 and 512),
  auth_key text not null check (length(auth_key) between 10 and 512),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table public.notification_preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  timezone text not null default 'UTC' check (length(timezone) between 1 and 100),
  morning_enabled boolean not null default false,
  morning_time time not null default '07:00',
  water_enabled boolean not null default false,
  water_time time not null default '12:00',
  sunscreen_enabled boolean not null default false,
  sunscreen_time time not null default '08:00',
  evening_enabled boolean not null default false,
  evening_time time not null default '19:00',
  bedtime_enabled boolean not null default false,
  bedtime_time time not null default '22:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.validate_notification_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then
    raise exception 'Timezone must be a valid IANA timezone identifier';
  end if;
  return new;
end;
$$;

create trigger notification_preferences_timezone_check
before insert or update of timezone on public.notification_preferences
for each row execute function public.validate_notification_timezone();

create index push_subscriptions_user_active_idx
  on public.push_subscriptions (user_id, active, updated_at desc);

alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy notification_preferences_select_own on public.notification_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
create policy notification_preferences_insert_own on public.notification_preferences
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy notification_preferences_update_own on public.notification_preferences
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy notification_preferences_delete_own on public.notification_preferences
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.push_subscriptions, public.notification_preferences from public, anon;
grant select, insert, update, delete on table public.push_subscriptions, public.notification_preferences to authenticated;
revoke all on function public.validate_notification_timezone() from public, anon;
grant execute on function public.validate_notification_timezone() to authenticated;

-- Claim is called only after the browser has obtained a real PushSubscription.
-- One endpoint can have only one account owner; transfer also refreshes its keys.
create or replace function public.claim_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
begin
  if v_user_id is null or p_endpoint !~ '^https://' then
    raise exception 'Authenticated push subscription required';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key, active, updated_at, revoked_at)
  values (v_user_id, p_endpoint, p_p256dh, p_auth_key, true, now(), null)
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth_key = excluded.auth_key,
    active = true,
    updated_at = now(),
    revoked_at = null
  where public.push_subscriptions.user_id = v_user_id
     or (public.push_subscriptions.p256dh = excluded.p256dh
         and public.push_subscriptions.auth_key = excluded.auth_key)
  returning id into v_id;

  if v_id is null then
    raise exception 'Push endpoint ownership could not be verified';
  end if;

  return v_id;
end;
$$;

-- Possession of the active browser subscription is required to deactivate it.
-- This permits safe account-switch cleanup after the old auth token is gone.
create or replace function public.deactivate_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row_count integer := 0;
begin
  if v_user_id is null then
    return false;
  end if;

  update public.push_subscriptions
  set active = false, revoked_at = now(), updated_at = now()
  where endpoint = p_endpoint and p256dh = p_p256dh and auth_key = p_auth_key and active;
  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;

revoke all on function public.claim_push_subscription(text, text, text) from public, anon;
revoke all on function public.deactivate_push_subscription(text, text, text) from public, anon;
grant execute on function public.claim_push_subscription(text, text, text) to authenticated;
grant execute on function public.deactivate_push_subscription(text, text, text) to authenticated;

comment on table public.push_subscriptions is
  'Per-device Web Push capability data. Endpoint and encryption keys are sensitive; never log or cache them.';
comment on table public.notification_preferences is
  'Account-owned opt-in preferences with local wall-clock times and an IANA timezone; no delivery is implemented.';

commit;
