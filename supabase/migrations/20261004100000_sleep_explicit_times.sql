alter table public.daily_ritual_entries
  add column sleep_time text,
  add column wake_time text;

alter table public.daily_ritual_entries
  add constraint daily_ritual_entries_sleep_time_format_check
    check (sleep_time is null or sleep_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint daily_ritual_entries_wake_time_format_check
    check (wake_time is null or wake_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint daily_ritual_entries_sleep_time_ritual_check
    check (sleep_time is null or ritual_id = 'sleep'),
  add constraint daily_ritual_entries_wake_time_ritual_check
    check (wake_time is null or ritual_id = 'wake');
