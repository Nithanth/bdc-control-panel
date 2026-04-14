-- 0005_schema_alignment.sql
-- Aligns schema with actual BDC domain requirements:
-- 1. Class sessions calendar with holiday support
-- 2. Per-session pause in attendance
-- 3. HNS (has-not-started) enrollment status
-- 4. Notes on attendance rows
--
-- NOTE: rate_cents on enrollments is the PACKAGE price (e.g. $100 for 4 classes).
-- Grandfathered pricing is handled by different rate_cents per enrollment.
-- No per-class rate column needed — the billing unit is the package.

-- ============================================================
-- 1. Class sessions calendar
-- ============================================================
-- One row per scheduled class date. is_holiday = true means studio is closed.
-- The billing worker should only count non-holiday sessions.

create table if not exists public.class_sessions (
  id          uuid primary key default gen_random_uuid(),
  class_name  text not null,
  session_date date not null,
  is_holiday  boolean not null default false,
  holiday_note text,
  created_at  timestamptz not null default now()
);

create unique index if not exists idx_class_sessions_unique
  on public.class_sessions(class_name, session_date);
create index if not exists idx_class_sessions_date
  on public.class_sessions(session_date);

alter table public.class_sessions enable row level security;
create policy "Admins can read class sessions" on public.class_sessions
  for select to authenticated using (true);
create policy "Admins can insert class sessions" on public.class_sessions
  for insert to authenticated with check (true);
create policy "Admins can update class sessions" on public.class_sessions
  for update to authenticated using (true) with check (true);
create policy "Admins can delete class sessions" on public.class_sessions
  for delete to authenticated using (true);

comment on table public.class_sessions is 'Calendar of class dates. Holiday sessions are tracked so billing skips them.';

-- ============================================================
-- 3. Per-session pause in attendance
-- ============================================================
-- Add "paused" to attendance_status so a student can be P for individual weeks.

alter type public.attendance_status add value if not exists 'paused';

-- ============================================================
-- 4. HNS enrollment status
-- ============================================================
-- "Has Not Started" — enrolled for planning but billing hasn't begun.

alter type public.enrollment_status add value if not exists 'hns';

-- ============================================================
-- 5. Notes on attendance rows
-- ============================================================
-- The spreadsheet uses the attendance cell for free-text notes
-- ("injury check in", "free didnt pause her class for workshop", etc.)

alter table public.attendance
  add column if not exists notes text;
