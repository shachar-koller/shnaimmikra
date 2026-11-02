-- Null retains the existing behavior: reopen the last mode used on this device.
-- Existing owner-only RLS and grants on profiles also cover this preference.
alter table public.profiles
  add column default_reader_mode text
    check (default_reader_mode in ('last-used', 'cards', 'flow', 'classic'));
