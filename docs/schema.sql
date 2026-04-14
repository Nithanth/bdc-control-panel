-- ============================================================
-- BDC Control Panel — Full Schema (reference)
-- ============================================================
-- This is the REFERENCE schema covering all phases.
-- Actual migrations are applied incrementally in supabase/migrations/.
-- Phase 1 tables: app_users, customers, contacts, square_payment_methods,
--                 enrollments, attendance, charges, audit_log, tags
-- Phase 2 tables: gigs, gig_participants
-- Phase 3 tables: expenses, vendors, recurring_expense_templates
-- Phase 4 tables: recitals, recital_registrations, corporate_events,
--                 corporate_event_milestones, contracts, contract_milestones
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

create type public.app_role as enum ('owner', 'admin', 'instructor');

create type public.customer_type as enum ('student', 'company', 'government', 'individual');

create type public.charge_status as enum ('pending', 'completed', 'failed', 'refunded', 'disputed');

create type public.source_module as enum (
  'classes', 'gigs', 'recitals', 'corporate', 'contracts', 'manual'
);

create type public.expense_module as enum (
  'classes', 'gigs', 'recitals', 'corporate', 'contracts', 'overhead'
);

create type public.enrollment_status as enum ('trial', 'active', 'paused', 'cancelled');

create type public.attendance_status as enum ('present', 'absent', 'excused');

create type public.gig_status as enum ('planning', 'confirmed', 'completed', 'cancelled');

create type public.expense_status as enum ('pending', 'paid', 'void');

create type public.recital_status as enum ('planning', 'registration_open', 'rehearsals', 'completed', 'cancelled');

create type public.event_status as enum ('quoted', 'confirmed', 'in_progress', 'completed', 'cancelled');

create type public.contract_status as enum ('draft', 'active', 'completed', 'cancelled');

create type public.milestone_status as enum ('pending', 'invoiced', 'paid');

-- ============================================================
-- SHARED: updated_at trigger function
-- ============================================================

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- CORE TABLES (used by every module)
-- ============================================================

-- Admin users — linked 1:1 to auth.users
create table public.app_users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       public.app_role not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.app_users is 'Admin users with roles. Linked 1:1 to auth.users.';
create index idx_app_users_email on public.app_users(email);
create trigger set_updated_at before update on public.app_users
  for each row execute function public.handle_updated_at();

-- Customers — generalizes "student" to include companies, agencies, etc.
create table public.customers (
  id              uuid primary key default gen_random_uuid(),
  type            public.customer_type not null default 'student',
  first_name      text,                          -- NULL for companies
  last_name       text,                          -- NULL for companies
  organization    text,                          -- NULL for individuals
  email           text,
  phone           text,
  date_of_birth   date,                          -- for minors: age verification
  is_minor        boolean not null default false,
  notes           text,
  active          boolean not null default true,
  square_customer_id text unique,                -- opaque Square reference
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.customers is 'Every student, company, or agency BDC does business with.';
comment on column public.customers.square_customer_id is 'Square Customer ID. We never store card numbers.';
create index idx_customers_active on public.customers(active) where active = true;
create index idx_customers_square on public.customers(square_customer_id) where square_customer_id is not null;
create index idx_customers_type on public.customers(type);
create trigger set_updated_at before update on public.customers
  for each row execute function public.handle_updated_at();

-- Contacts — humans attached to a customer (parent, billing contact, etc.)
create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name        text not null,
  relationship text,                              -- 'parent', 'guardian', 'AP contact', etc.
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

-- Square payment methods — opaque references to cards on file
create table public.square_payment_methods (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references public.customers(id) on delete cascade,
  square_card_id    text not null,                -- Square Card ID (opaque token)
  card_brand        text,                         -- 'VISA', 'MASTERCARD', etc.
  last_four         text,                         -- last 4 digits for display only
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

-- Charges — every dollar IN, from any module
create table public.charges (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references public.customers(id),
  source_module     public.source_module not null,
  source_id         uuid,                         -- FK to the module-specific record (enrollment, gig, etc.)
  amount_cents      integer not null check (amount_cents > 0),
  description       text,
  status            public.charge_status not null default 'pending',
  square_payment_id text,                         -- Square Payment ID after charge fires
  idempotency_key   text not null unique,         -- deterministic key to prevent double-charges
  error_message     text,                         -- populated on failure
  charged_at        timestamptz,                  -- when Square processed it
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.charges is 'Every dollar of revenue. Polymorphic via source_module + source_id.';
comment on column public.charges.idempotency_key is 'Deterministic key (e.g., class-{student}-pack-{n}). Prevents double-charges on retry.';
create index idx_charges_customer on public.charges(customer_id);
create index idx_charges_source on public.charges(source_module, source_id);
create index idx_charges_status on public.charges(status);
create index idx_charges_created on public.charges(created_at);
create trigger set_updated_at before update on public.charges
  for each row execute function public.handle_updated_at();

-- Tags — flags on customers for bulk actions
create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  tag         text not null,                      -- e.g., 'performing_spurs_2025_11_15'
  created_at  timestamptz not null default now()
);
comment on table public.tags is 'Flags on customers for filtering and bulk operations.';
create index idx_tags_customer on public.tags(customer_id);
create index idx_tags_tag on public.tags(tag);
create unique index idx_tags_unique on public.tags(customer_id, tag);

-- Audit log — append-only, immutable record of every state change
create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id),     -- who did it (NULL for system actions)
  action      text not null,                      -- 'attendance.marked', 'charge.created', etc.
  table_name  text not null,
  record_id   uuid,
  old_data    jsonb,
  new_data    jsonb,
  metadata    jsonb,                              -- extra context (idempotency_key, Square response, etc.)
  created_at  timestamptz not null default now()
);
comment on table public.audit_log is 'Append-only record of every state change. Cannot be updated or deleted.';
create index idx_audit_log_action on public.audit_log(action);
create index idx_audit_log_table on public.audit_log(table_name, record_id);
create index idx_audit_log_created on public.audit_log(created_at);

-- Block UPDATE and DELETE on audit_log
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
-- PHASE 1: CLASSES MODULE
-- ============================================================

-- Enrollments — a student enrolled in a class
create table public.enrollments (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id),
  class_name      text not null,                  -- 'Beginner Bollywood Monday', etc.
  status          public.enrollment_status not null default 'active',
  pack_size       integer not null default 4 check (pack_size > 0),
  rate_cents      integer not null check (rate_cents > 0),  -- price per pack
  current_pack    integer not null default 1,     -- which pack the student is on
  classes_in_pack integer not null default 0,     -- how many attended in current pack
  started_at      date not null default current_date,
  paused_at       date,
  cancelled_at    date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.enrollments is 'A student enrolled in a recurring class. Tracks pack progress.';
comment on column public.enrollments.pack_size is 'Number of classes per billing pack (usually 4).';
comment on column public.enrollments.classes_in_pack is 'Classes attended in the current pack. Resets to 0 when pack is billed.';
create index idx_enrollments_customer on public.enrollments(customer_id);
create index idx_enrollments_status on public.enrollments(status) where status = 'active';
create trigger set_updated_at before update on public.enrollments
  for each row execute function public.handle_updated_at();

-- Attendance — one row per student per class session
create table public.attendance (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  customer_id   uuid not null references public.customers(id),
  class_date    date not null,
  status        public.attendance_status not null default 'present',
  billed        boolean not null default false,   -- true once included in a charge
  charge_id     uuid references public.charges(id),  -- FK to the charge that billed this
  marked_by     uuid references auth.users(id),   -- which admin marked attendance
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
-- PHASE 2: GIGS MODULE
-- ============================================================

create table public.gigs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                    -- 'Spurs Nov 15', 'Warriors Dec 3', etc.
  venue         text,
  gig_date      date,
  status        public.gig_status not null default 'planning',
  fee_cents     integer not null default 0 check (fee_cents >= 0),  -- per-participant fee
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.gigs is 'Performance gigs (Spurs, Warriors, parades, festivals).';
create trigger set_updated_at before update on public.gigs
  for each row execute function public.handle_updated_at();

create table public.gig_participants (
  id          uuid primary key default gen_random_uuid(),
  gig_id      uuid not null references public.gigs(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  charge_id   uuid references public.charges(id), -- NULL until charged
  created_at  timestamptz not null default now()
);
comment on table public.gig_participants is 'Students participating in a gig.';
create unique index idx_gig_participants_unique on public.gig_participants(gig_id, customer_id);
create index idx_gig_participants_gig on public.gig_participants(gig_id);

-- ============================================================
-- PHASE 3: EXPENSES MODULE
-- ============================================================

create table public.vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text,                               -- 'costume', 'venue', 'insurance', etc.
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.vendors is 'Companies/people BDC pays money to.';
create trigger set_updated_at before update on public.vendors
  for each row execute function public.handle_updated_at();

create table public.expenses (
  id                    uuid primary key default gen_random_uuid(),
  vendor_id             uuid references public.vendors(id),
  allocated_to_module   public.expense_module not null default 'overhead',
  allocated_to_id       uuid,                     -- FK to gig, recital, contract, etc. NULL for overhead
  amount_cents          integer not null check (amount_cents > 0),
  description           text not null,
  category              text,                     -- 'costume', 'travel', 'venue_rental', 'software', etc.
  status                public.expense_status not null default 'paid',
  receipt_path          text,                     -- Supabase Storage path to receipt image
  expense_date          date not null default current_date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table public.expenses is 'Every dollar out. Polymorphic via allocated_to_module + allocated_to_id.';
create index idx_expenses_module on public.expenses(allocated_to_module, allocated_to_id);
create index idx_expenses_vendor on public.expenses(vendor_id);
create index idx_expenses_date on public.expenses(expense_date);
create trigger set_updated_at before update on public.expenses
  for each row execute function public.handle_updated_at();

create table public.recurring_expense_templates (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid references public.vendors(id),
  description   text not null,                    -- 'Monthly rent', 'Liability insurance', etc.
  amount_cents  integer not null check (amount_cents > 0),
  frequency     text not null default 'monthly',  -- 'monthly', 'quarterly', 'annual'
  category      text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.recurring_expense_templates is 'Templates for expenses that repeat (rent, insurance, etc.).';
create trigger set_updated_at before update on public.recurring_expense_templates
  for each row execute function public.handle_updated_at();

-- ============================================================
-- PHASE 4: RECITALS
-- ============================================================

create table public.recitals (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                    -- 'Spring Recital 2025'
  recital_date  date,
  venue         text,
  status        public.recital_status not null default 'planning',
  fee_cents     integer not null default 0,       -- registration fee per student
  costume_fee_cents integer not null default 0,   -- costume fee per student
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger set_updated_at before update on public.recitals
  for each row execute function public.handle_updated_at();

create table public.recital_registrations (
  id            uuid primary key default gen_random_uuid(),
  recital_id    uuid not null references public.recitals(id) on delete cascade,
  customer_id   uuid not null references public.customers(id),
  fee_charge_id uuid references public.charges(id),
  costume_charge_id uuid references public.charges(id),
  costume_size  text,
  notes         text,
  created_at    timestamptz not null default now()
);
create unique index idx_recital_reg_unique on public.recital_registrations(recital_id, customer_id);

-- ============================================================
-- PHASE 4: CORPORATE EVENTS
-- ============================================================

create table public.corporate_events (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id),  -- the company
  name            text not null,
  event_date      date,
  status          public.event_status not null default 'quoted',
  quoted_cents    integer not null default 0,
  deposit_cents   integer not null default 0,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger set_updated_at before update on public.corporate_events
  for each row execute function public.handle_updated_at();

create table public.corporate_event_milestones (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.corporate_events(id) on delete cascade,
  description   text not null,                    -- 'Deposit', 'Final payment', etc.
  amount_cents  integer not null check (amount_cents > 0),
  status        public.milestone_status not null default 'pending',
  due_date      date,
  charge_id     uuid references public.charges(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger set_updated_at before update on public.corporate_event_milestones
  for each row execute function public.handle_updated_at();

-- ============================================================
-- PHASE 4: CONTRACTS (government, B2B — no Square)
-- ============================================================

create table public.contracts (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id),
  name            text not null,                  -- 'City of San Antonio Arts Grant 2025'
  status          public.contract_status not null default 'draft',
  total_cents     integer not null default 0,
  start_date      date,
  end_date        date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger set_updated_at before update on public.contracts
  for each row execute function public.handle_updated_at();

create table public.contract_milestones (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references public.contracts(id) on delete cascade,
  description   text not null,                    -- 'Q1 deliverable', 'Final report', etc.
  amount_cents  integer not null check (amount_cents > 0),
  status        public.milestone_status not null default 'pending',
  due_date      date,
  paid_date     date,                             -- manual entry: when check/ACH arrived
  charge_id     uuid references public.charges(id),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger set_updated_at before update on public.contract_milestones
  for each row execute function public.handle_updated_at();

-- ============================================================
-- ROW-LEVEL SECURITY (RLS)
-- ============================================================
-- Strategy: all authenticated admins can read everything.
-- Writes go through Server Actions or Edge Functions using the service_role key.
-- audit_log is append-only (insert allowed, no update/delete via trigger).
-- Future: instructor role gets scoped read policies.

alter table public.app_users enable row level security;
create policy "Users can read own row" on public.app_users
  for select to authenticated using (auth.uid() = id);

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

alter table public.gigs enable row level security;
create policy "Admins can read gigs" on public.gigs
  for select to authenticated using (true);

alter table public.gig_participants enable row level security;
create policy "Admins can read gig participants" on public.gig_participants
  for select to authenticated using (true);

alter table public.vendors enable row level security;
create policy "Admins can read vendors" on public.vendors
  for select to authenticated using (true);

alter table public.expenses enable row level security;
create policy "Admins can read expenses" on public.expenses
  for select to authenticated using (true);

alter table public.recurring_expense_templates enable row level security;
create policy "Admins can read expense templates" on public.recurring_expense_templates
  for select to authenticated using (true);

alter table public.recitals enable row level security;
create policy "Admins can read recitals" on public.recitals
  for select to authenticated using (true);

alter table public.recital_registrations enable row level security;
create policy "Admins can read recital registrations" on public.recital_registrations
  for select to authenticated using (true);

alter table public.corporate_events enable row level security;
create policy "Admins can read corporate events" on public.corporate_events
  for select to authenticated using (true);

alter table public.corporate_event_milestones enable row level security;
create policy "Admins can read event milestones" on public.corporate_event_milestones
  for select to authenticated using (true);

alter table public.contracts enable row level security;
create policy "Admins can read contracts" on public.contracts
  for select to authenticated using (true);

alter table public.contract_milestones enable row level security;
create policy "Admins can read contract milestones" on public.contract_milestones
  for select to authenticated using (true);
