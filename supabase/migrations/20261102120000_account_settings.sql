-- Every setting now follows the account. Null means the account has never saved
-- that setting: the app then uses its default, or uploads a choice a device
-- already has. Option lists are checked in the app, so adding a theme needs no migration.
-- Existing owner-only RLS and table grants cover the new columns.
alter table public.profiles drop constraint profiles_theme_check;
-- 'dark' and 'light' came from an old theme system and are not current themes.
update public.profiles set theme = null where theme in ('dark', 'light');

alter table public.profiles
  add column peirush_name text check (char_length(peirush_name) <= 80),
  add column follow_device boolean,
  add column light_theme text,
  add column dark_theme text,
  add column text_size text,
  add column glass smallint check (glass between 0 and 100),
  add column naming text,
  add column confetti boolean,
  add column vibration boolean,
  add column reminder_days smallint[],
  add column reminder_time text;
