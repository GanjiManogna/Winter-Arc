-- Allow the existing per-device delivery ledger to record scheduled Water reminders.
-- This widens only the notification category check; existing rows and RLS remain intact.
begin;

alter table public.notification_delivery_events
  drop constraint if exists notification_delivery_events_category_check;

alter table public.notification_delivery_events
  add constraint notification_delivery_events_category_check
  check (category in ('morning', 'evening', 'bedtime', 'sunscreen', 'weekly', 'water'));

commit;
