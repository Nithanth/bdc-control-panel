-- 0003_write_policies.sql
-- Add INSERT, UPDATE, DELETE policies for authenticated admin users.
-- All authenticated users are admins in v1, so allow all writes.

-- customers
create policy "Admins can insert customers" on public.customers
  for insert to authenticated with check (true);
create policy "Admins can update customers" on public.customers
  for update to authenticated using (true) with check (true);
create policy "Admins can delete customers" on public.customers
  for delete to authenticated using (true);

-- contacts
create policy "Admins can insert contacts" on public.contacts
  for insert to authenticated with check (true);
create policy "Admins can update contacts" on public.contacts
  for update to authenticated using (true) with check (true);
create policy "Admins can delete contacts" on public.contacts
  for delete to authenticated using (true);

-- square_payment_methods
create policy "Admins can insert payment methods" on public.square_payment_methods
  for insert to authenticated with check (true);
create policy "Admins can update payment methods" on public.square_payment_methods
  for update to authenticated using (true) with check (true);
create policy "Admins can delete payment methods" on public.square_payment_methods
  for delete to authenticated using (true);

-- charges
create policy "Admins can insert charges" on public.charges
  for insert to authenticated with check (true);
create policy "Admins can update charges" on public.charges
  for update to authenticated using (true) with check (true);

-- tags
create policy "Admins can insert tags" on public.tags
  for insert to authenticated with check (true);
create policy "Admins can delete tags" on public.tags
  for delete to authenticated using (true);

-- audit_log (insert only — update/delete blocked by trigger)
-- Policy already exists from 0002, but adding for completeness if not present
-- create policy "System can insert audit log" on public.audit_log
--   for insert to authenticated with check (true);

-- enrollments
create policy "Admins can insert enrollments" on public.enrollments
  for insert to authenticated with check (true);
create policy "Admins can update enrollments" on public.enrollments
  for update to authenticated using (true) with check (true);
create policy "Admins can delete enrollments" on public.enrollments
  for delete to authenticated using (true);

-- attendance
create policy "Admins can insert attendance" on public.attendance
  for insert to authenticated with check (true);
create policy "Admins can update attendance" on public.attendance
  for update to authenticated using (true) with check (true);
create policy "Admins can delete attendance" on public.attendance
  for delete to authenticated using (true);
