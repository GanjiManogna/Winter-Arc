-- Per-device at-most-once delivery ledger and a Vault-backed minute scheduler.
-- Apply only after the 13E-B notification foundation migration.
begin;

create extension if not exists pg_cron;
create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;
create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;

do $$
declare
  existing_constraint_definition text;
begin
  select pg_get_constraintdef(constraint_row.oid)
    into existing_constraint_definition
  from pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.push_subscriptions'::regclass
    and constraint_row.conname = 'push_subscriptions_id_user_id_key'
    and constraint_row.contype = 'u';

  if existing_constraint_definition is null then
    alter table public.push_subscriptions
      add constraint push_subscriptions_id_user_id_key unique (id, user_id);
  elsif existing_constraint_definition <> 'UNIQUE (id, user_id)' then
    raise exception 'Existing push_subscriptions_id_user_id_key has unexpected definition: %',
      existing_constraint_definition;
  end if;
end;
$$;
alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_provider_check
  check (endpoint ~* '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|web\.push\.apple\.com)(/|$)');

create table public.notification_delivery_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subscription_id uuid not null,
  local_date date not null,
  category text not null check (category in ('morning', 'evening', 'bedtime')),
  scheduled_time time not null,
  scheduled_timezone text not null check (length(scheduled_timezone) between 1 and 100),
  state text not null default 'claimed'
    check (state in ('claimed', 'accepted', 'invalid', 'failed')),
  response_status smallint check (response_status between 100 and 599),
  attempted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_delivery_events_subscription_owner_fkey
    foreign key (subscription_id, user_id)
    references public.push_subscriptions (id, user_id) on delete cascade,
  constraint notification_delivery_events_once_per_device_key
    unique (user_id, local_date, category, scheduled_time, subscription_id)
);

create index notification_preferences_enabled_idx
  on public.notification_preferences (user_id) where enabled;
create index notification_delivery_events_user_date_idx
  on public.notification_delivery_events (user_id, local_date desc);

alter table public.notification_delivery_events enable row level security;
create policy notification_delivery_events_select_own on public.notification_delivery_events
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.notification_delivery_events from public, anon, authenticated;
grant select on table public.notification_delivery_events to authenticated;
grant select, insert, update on table public.notification_delivery_events to service_role;
grant select on table public.notification_preferences to service_role;
grant select, update on table public.push_subscriptions to service_role;

-- This helper has no client grant. pg_cron runs it as the database role that
-- installed the job; only URL/key material stored in Vault is read here.
create or replace function public.invoke_notification_dispatcher()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_url text;
  v_publishable_key text;
  v_dispatch_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_project_url
  from vault.decrypted_secrets where name = 'notification_project_url' limit 1;
  select decrypted_secret into v_publishable_key
  from vault.decrypted_secrets where name = 'notification_publishable_key' limit 1;
  select decrypted_secret into v_dispatch_secret
  from vault.decrypted_secrets where name = 'notification_dispatch_secret' limit 1;

  if coalesce(v_project_url, '') = ''
     or coalesce(v_publishable_key, '') = ''
     or coalesce(v_dispatch_secret, '') = '' then
    return null;
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/notification-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_publishable_key,
      'x-dispatch-secret', v_dispatch_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.invoke_notification_dispatcher() from public, anon, authenticated;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'winter-arc-notification-dispatcher'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule(
    'winter-arc-notification-dispatcher',
    '* * * * *',
    'select public.invoke_notification_dispatcher();'
  );
end;
$$;

comment on table public.notification_delivery_events is
  'At-most-once per account/device/category/local scheduled slot ledger for Web Push. Failed or uncertain sends are not automatically retried.';
comment on function public.invoke_notification_dispatcher() is
  'Minute-based pg_cron hook. It is inert until the three notification_* values are configured in Supabase Vault.';

commit;
