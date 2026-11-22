-- Add application-relative Sunscreen and generic weekly reminder preferences.
-- Weekdays use ISO numbering: Monday=1 through Sunday=7.
-- Existing sunscreen_time is retained for compatibility and is not used for interval scheduling.
begin;

alter table public.notification_preferences
  add column weekly_enabled boolean not null default false,
  add column weekly_day smallint,
  add column weekly_time time,
  add column weekly_name text;

alter table public.notification_preferences
  add constraint notification_preferences_weekly_day_check
    check (weekly_day is null or weekly_day between 1 and 7),
  add constraint notification_preferences_weekly_name_check
    check (weekly_name is null or (length(btrim(weekly_name)) between 1 and 80)),
  add constraint notification_preferences_weekly_configuration_check
    check (
      not weekly_enabled
      or (
        weekly_day between 1 and 7
        and weekly_time is not null
        and weekly_name is not null
        and length(btrim(weekly_name)) between 1 and 80
      )
    );

comment on column public.notification_preferences.weekly_day is
  'ISO weekday for the weekly reminder: Monday=1 through Sunday=7.';
comment on column public.notification_preferences.weekly_name is
  'Private settings label only; never included in notification payloads.';
comment on column public.notification_preferences.sunscreen_time is
  'Legacy fixed-time preference retained for compatibility; Sunscreen interval scheduling ignores this value.';

alter table public.notification_delivery_events
  drop constraint if exists notification_delivery_events_category_check;
alter table public.notification_delivery_events
  add constraint notification_delivery_events_category_check
  check (category in ('morning', 'evening', 'bedtime', 'sunscreen', 'weekly'));

-- Include timezone in occurrence identity. The old constraint could collapse
-- two distinct saved-timezone occurrences sharing local date/time and device.
-- Widening the key preserves every existing row and its claim history.
alter table public.notification_delivery_events
  drop constraint if exists notification_delivery_events_once_per_device_key;
alter table public.notification_delivery_events
  add constraint notification_delivery_events_once_per_device_key
  unique (user_id, local_date, category, scheduled_time, scheduled_timezone, subscription_id);

commit;
