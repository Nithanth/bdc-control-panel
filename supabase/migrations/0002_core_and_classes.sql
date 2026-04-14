-- 0002_core_and_classes.sql
-- Phase 1: Core tables + Classes module tables.
-- Depends on: 0001_init.sql (app_users, app_role enum, handle_updated_at function)

-- ============================================================
-- ENUMS
-- ============================================================

create type public.customer_type as enum ('student', 'company', 'government', 'individual');
create type public.charge_status as enum ('pending', 'completed', 'failed', 'refunded', 'disputed');
create type public.source_module as enum ('classes', 'gigs', 'recitals', 'corporate', 'contracts', 'manual');
create type public.enrollment_status as enum ('trial', 'active', 'paused', 'cancelled');
create type public.attendance_status as enum ('present', 'absent', 'excused');

-- ============================================================
-- CORE: customers
-- ============================================================

create table public.customers (
  id              uuid primary key default gen_random_uuid(),
  type            public.customer_type not null default 'student',
  first_name      text,
  last_name       text,
  organization    text,
  email           text,
  phone           text,
  date_of_birth   date,
  is_minor        boolean not null default false,
  notes           text,
  active          boolean not null default true,
  square_customer_id text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.customers is 'Every student, company, or agency BDC does business with.';
create index idx_customers_active on public.customers(active) where active = true;
create index idx_customers_square on public.customers(square_customer_id) where square_customer_id is not null;
create index idx_customers_type on public.customers(type);
create trigger set_updated_at before update on public.customers
  for each row execute function public.handle_updated_at();

-- ============================================================
-- CORE: contacts
-- ============================================================

create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name        text not null,
  relationship text,
  email       text,
  phone       text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.contacts is 'People attached to a customer (parents, billing contacts, etc.).';
create index idx_contacts_customer on public.contacts(customer_id);
create trigger set_updated_at before update on public.contacts
  for each row execute function public.handle_updated_at();

-- ============================================================
-- CORE: square_payment_methods
-- ============================================================

create table public.square_payment_methods (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references public.customers(id) on delete cascade,
  square_card_id    text not null,
  card_brand        text,
  last_four         text,
  exp_month         integer,
  exp_year          integer,
  is_default        boolean not null default false,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.square_payment_methods is 'Opaque references to cards stored in Square. NEVER contains full card numbers.';
create index idx_spm_customer on public.square_payment_methods(customer_id);
create trigger set_updated_at before update on public.square_payment_methods
  for each row execute function public.handle_updated_at();

-- ============================================================
-- CORE: charges
-- ============================================================

create table public.charges (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references public.customers(id),
  source_module     public.source_module not null,
  source_id         uuid,
  amount_cents      integer not null check (amount_cents > 0),
  description       text,
  status            public.charge_status not null default 'pending',
  square_payment_id text,
  idempotency_key   text not null unique,
  error_message     text,
  charged_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.charges is 'Every dollar of revenue. Polymorphic via source_module + source_id.';
create index idx_charges_customer on public.charges(customer_id);
create index idx_charges_source on public.charges(source_module, source_id);
create index idx_charges_status on public.charges(status);
create index idx_charges_created on public.charges(created_at);
create trigger set_updated_at before update on public.charges
  for each row execute function public.handle_updated_at();

-- ============================================================
-- CORE: tags
-- ============================================================

create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  tag         text not null,
  created_at  timestamptz not null default now()
);

comment on table public.tags is 'Flags on customers for filtering and bulk operations.';
create index idx_tags_customer on public.tags(customer_id);
create index idx_tags_tag on public.tags(tag);
create unique index idx_tags_unique on public.tags(customer_id, tag);

-- ============================================================
-- CORE: audit_log (append-only)
-- ============================================================

create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id),
  action      text not null,
  table_name  text not null,
  record_id   uuid,
  old_data    jsonb,
  new_data    jsonb,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.audit_log is 'Append-only record of every state change. Cannot be updated or deleted.';
create index idx_audit_log_action on public.audit_log(action);
create index idx_audit_log_table on public.audit_log(table_name, record_id);
create index idx_audit_log_created on public.audit_log(created_at);

create or replace function public.audit_log_immutable()
returns trigger as $$
begin
  raise exception 'audit_log is append-only. Updates and deletes are not allowed.';
end;
$$ language plpgsql;

create trigger enforce_audit_immutability
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- ============================================================
-- CLASSES: enrollments
-- ============================================================

create table public.enrollments (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id),
  class_name      text not null,
  status          public.enrollment_status not null default 'active',
  pack_size       integer not null default 4 check (pack_size > 0),
  rate_cents      integer not null check (rate_cents > 0),
  current_pack    integer not null default 1,
  classes_in_pack integer not null default 0,
  started_at      date not null default current_date,
  paused_at       date,
  cancelled_at    date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.enrollments is 'A student enrolled in a recurring class. Tracks pack progress.';
create index idx_enrollments_customer on public.enrollments(customer_id);
create index idx_enrollments_status on public.enrollments(status) where status = 'active';
create trigger set_updated_at before update on public.enrollments
  for each row execute function public.handle_updated_at();

-- ============================================================
-- CLASSES: attendance
-- ============================================================

create table public.attendance (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  customer_id   uuid not null references public.customers(id),
  class_date    date not null,
  status        public.attendance_status not null default 'present',
  billed        boolean not null default false,
  charge_id     uuid references public.charges(id),
  marked_by     uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.attendance is 'One row per student per class session. Tracks whether it has been billed.';
create index idx_attendance_enrollment on public.attendance(enrollment_id);
create index idx_attendance_customer on public.attendance(customer_id);
create index idx_attendance_date on public.attendance(class_date);
create index idx_attendance_unbilled on public.attendance(enrollment_id) where billed = false and status = 'present';
create unique index idx_attendance_unique on public.attendance(enrollment_id, class_date);
create trigger set_updated_at before update on public.attendance
  for each row execute function public.handle_updated_at();

-- ============================================================
-- RLS POLICIES
-- ============================================================

alter table public.customers enable row level security;
create policy "Admins can read all customers" on public.customers
  for select to authenticated using (true);

alter table public.contacts enable row level security;
create policy "Admins can read all contacts" on public.contacts
  for select to authenticated using (true);

alter table public.square_payment_methods enable row level security;
create policy "Admins can read payment methods" on public.square_payment_methods
  for select to authenticated using (true);

alter table public.charges enable row level security;
create policy "Admins can read all charges" on public.charges
  for select to authenticated using (true);

alter table public.tags enable row level security;
create policy "Admins can read all tags" on public.tags
  for select to authenticated using (true);

alter table public.audit_log enable row level security;
create policy "Admins can read audit log" on public.audit_log
  for select to authenticated using (true);
create policy "System can insert audit log" on public.audit_log
  for insert to authenticated with check (true);

alter table public.enrollments enable row level security;
create policy "Admins can read enrollments" on public.enrollments
  for select to authenticated using (true);

alter table public.attendance enable row level security;
create policy "Admins can read attendance" on public.attendance
  for select to authenticated using (true);
