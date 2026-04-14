-- 0004_billing_mode_and_queue.sql
-- Adds per-enrollment billing mode and a billing queue for tracking outstanding packs.

-- Add billing_mode to enrollments (auto = auto-charge, manual = admin decides)
alter table public.enrollments
  add column if not exists billing_mode text not null default 'manual'
  check (billing_mode in ('auto', 'manual'));

-- Billing queue: one row per pack that is due / paid / failed
create table if not exists public.billing_queue (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  customer_id uuid not null references public.customers(id),
  pack_number integer not null,
  amount_cents integer not null,
  status text not null default 'due' check (status in ('due', 'paid', 'failed', 'waived')),
  charge_id uuid references public.charges(id),
  due_at timestamptz not null default now(),
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (enrollment_id, pack_number)
);

-- RLS
alter table public.billing_queue enable row level security;

create policy "Admins can read billing queue" on public.billing_queue
  for select to authenticated using (true);
create policy "Admins can insert billing queue" on public.billing_queue
  for insert to authenticated with check (true);
create policy "Admins can update billing queue" on public.billing_queue
  for update to authenticated using (true) with check (true);
create policy "Admins can delete billing queue" on public.billing_queue
  for delete to authenticated using (true);

-- Index for fast lookups
create index if not exists idx_billing_queue_status on public.billing_queue(status);
create index if not exists idx_billing_queue_customer on public.billing_queue(customer_id);
