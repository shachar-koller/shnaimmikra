-- Shnayim Mikra — auth + cloud sync schema
-- Run this in Supabase Dashboard → SQL Editor (or `supabase db push`).
-- Assumes Supabase Auth (auth.users) exists. Least-privilege RLS: users can
-- only touch their own rows. anon has no access; authenticated only own rows.

-- ── profiles: per-user settings (1 row per auth.users.id) ────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  israel boolean not null default false,
  commentary text not null default 'onkelos' check (commentary in ('onkelos', 'rashi')),
  theme text check (theme in ('dark', 'light')),
  updated_at timestamptz not null default now()
);

-- ── progress: one row per (user, cycle year, parsha id) ──────────────────
create table if not exists public.progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  year integer not null,
  parsha_id text not null,
  mikra1 boolean not null default false,
  mikra2 boolean not null default false,
  onkelos boolean not null default false,
  rashi boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, year, parsha_id)
);
create index if not exists progress_user_year_idx on public.progress (user_id, year);

-- ── updated_at auto-touch ────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists progress_touch on public.progress;
create trigger progress_touch before update on public.progress
  for each row execute function public.touch_updated_at();

-- ── auto-create profile on signup ────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Row Level Security (the "correct permissions" part) ─────────────────
alter table public.profiles enable row level security;
alter table public.progress enable row level security;

-- profiles: owner-only
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete to authenticated using (auth.uid() = id);

-- progress: owner-only
drop policy if exists "progress_select_own" on public.progress;
create policy "progress_select_own" on public.progress
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "progress_insert_own" on public.progress;
create policy "progress_insert_own" on public.progress
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "progress_update_own" on public.progress;
create policy "progress_update_own" on public.progress
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "progress_delete_own" on public.progress;
create policy "progress_delete_own" on public.progress
  for delete to authenticated using (auth.uid() = user_id);

-- Explicit least-privilege grants (service_role bypasses RLS; anon gets nothing)
revoke all on public.profiles from anon, authenticated;
revoke all on public.progress from anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.progress to authenticated;
