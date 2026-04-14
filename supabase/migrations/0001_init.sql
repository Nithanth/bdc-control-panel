-- 0001_init.sql
-- Bootstrap: app_users table for admin role tracking.
-- Links to Supabase auth.users via id (same UUID).
-- RLS enabled: users can only read their own row.

-- Role enum for admin users
create type public.app_role as enum ('owner', 'admin', 'instructor');

-- App users table — one row per admin, linked 1:1 to auth.users
create table public.app_users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       public.app_role not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_users is 'Admin users with roles. Linked 1:1 to auth.users.';

-- Index on email for lookups
create index idx_app_users_email on public.app_users(email);

-- Auto-update updated_at on row change
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at
  before update on public.app_users
  for each row
  execute function public.handle_updated_at();

-- Enable RLS — no exceptions
alter table public.app_users enable row level security;

-- Policy: authenticated users can read their own row only
create policy "Users can read own row"
  on public.app_users
  for select
  to authenticated
  using (auth.uid() = id);

-- Policy: only service_role can insert/update/delete (used by seed and admin operations)
-- No explicit policy = denied for non-service-role, which is the correct default.
