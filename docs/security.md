# Security & PII Protection

This document converts the eight security layers from the master spec into a concrete checklist with implementation notes. This system handles **PII for minors** — security is not optional.

---

## Layer 1: Don't store what we don't need

**What to do:**

- No SSNs, ever. No use case.
- No full card numbers, CVVs, or expiry dates. Square holds card data; we hold opaque `card_id` tokens.
- Minimal medical info. Only store allergy/medical notes if the studio requires it, and mark the column for `pgsodium` encryption.
- No photos of minors in the database. If needed for recital programs, use Supabase Storage with time-limited signed URLs, not public links.

**How to verify:**

- Review `schema.sql` — no columns named `ssn`, `card_number`, `cvv`, `full_card`, etc.
- `square_payment_methods` table stores only `square_card_id`, `card_brand`, `last_four`, `exp_month`, `exp_year`.
- Grep the codebase for any raw card data handling — should return zero results.

---

## Layer 2: Encryption at rest and in transit

**What to do:**

- **At rest:** Supabase encrypts all data at rest by default (AES-256). No action needed beyond using Supabase.
- **In transit:** All connections use TLS. Supabase enforces this. Vercel enforces HTTPS on the frontend.
- **Column encryption:** Use `pgsodium` for especially sensitive fields if needed (e.g., medical notes). For v1, the default encryption is sufficient since we're not storing high-sensitivity data beyond names and contact info.

**How to verify:**

- Supabase Dashboard → Settings → confirm encryption at rest is enabled (it is by default on all plans).
- Try accessing the app via `http://` — should redirect to `https://` (Vercel does this automatically).

---

## Layer 3: Row-Level Security (RLS) on every table

**What to do:**

- RLS is enabled on every table in the schema. No exceptions.
- Default policy for v1: all authenticated admin users can SELECT all rows. Writes go through Server Actions or Edge Functions using the `service_role` key (which bypasses RLS).
- `audit_log` has an additional immutability trigger: UPDATE and DELETE are blocked even for service_role.
- Future instructor role: scoped SELECT policies (e.g., instructors can only see students in their classes).

**RLS policy patterns:**

```sql
-- Pattern 1: User reads own row only (app_users)
create policy "Users can read own row" on public.app_users
  for select to authenticated using (auth.uid() = id);

-- Pattern 2: All admins can read everything (most tables)
create policy "Admins can read all" on public.customers
  for select to authenticated using (true);

-- Pattern 3: Append-only (audit_log)
create policy "System can insert audit log" on public.audit_log
  for insert to authenticated with check (true);
-- UPDATE/DELETE blocked by trigger, not policy.

-- Pattern 4 (future): Instructor scoped access
-- create policy "Instructors see own students" on public.enrollments
--   for select to authenticated
--   using (
--     exists (
--       select 1 from public.app_users
--       where id = auth.uid() and role = 'owner'
--     )
--     or instructor_id = auth.uid()
--   );
```

**How to verify:**

- Run `select tablename, rowsecurity from pg_tables where schemaname = 'public';` in the SQL Editor. Every table should show `rowsecurity = true`.
- Test: log in as a non-service-role user and try to INSERT into `customers` directly via the Supabase JS client. It should be denied.

---

## Layer 4: Least privilege roles

**What to do:**

- `app_role` enum: `owner`, `admin`, `instructor`.
- **Owner:** full access to everything, including user management and billing configuration.
- **Admin:** full operational access (students, attendance, charges, expenses). Cannot manage other users.
- **Instructor (future):** can mark attendance for their own classes only. Cannot see billing, charges, or other students.
- The `service_role` key is used only in Edge Functions and Server Actions — never exposed to the browser.

**How to verify:**

- Check `app_users` table — every user has an explicit role.
- Check that `SUPABASE_SERVICE_ROLE_KEY` only appears in server-side code (`.env.local`, Edge Functions), never in files under `src/app/` client components.
- Grep: `grep -r "SERVICE_ROLE" apps/web/src/` should return zero results in client components.

---

## Layer 5: Secrets management

**What to do:**

- All secrets live in environment variables:
  - **Local dev:** `apps/web/.env.local` (gitignored)
  - **Production (Vercel):** Vercel Dashboard → Settings → Environment Variables
  - **Edge Functions:** Supabase Dashboard → Edge Functions → Secrets
- `.env.local` is in `.gitignore` at both the repo root and `apps/web/` level.
- `.env.example` contains placeholder values only — never real keys.
- Square access tokens, Supabase service role keys, and webhook signing keys are **server-only** — never prefixed with `NEXT_PUBLIC_`.

**How to verify:**

- `git log --all --diff-filter=A -- '*.env*'` — should show only `.env.example`, never `.env.local` or `.env.production`.
- Review `apps/web/.env.local` — confirm it's in `.gitignore`.
- Review all `NEXT_PUBLIC_` prefixed vars — should only be Supabase URL, anon key, and app URL. Never service role or Square secret keys.

---

## Layer 6: 2FA and authentication hardening

**What to do:**

- **2FA:** Enable TOTP-based 2FA for all admin accounts via Supabase Auth MFA. Required for production, optional in dev.
- **Password requirements:** Supabase Auth default minimum is 6 characters. For production, configure to require 12+ characters.
- **Session timeouts:** Configure Supabase Auth JWT expiry to 1 hour. Refresh tokens handle seamless re-auth, but inactive sessions expire.
- **Rate limiting:** Supabase Auth has built-in rate limiting on login attempts.

**How to verify:**

- Supabase Dashboard → Authentication → Policies → confirm MFA is enabled for production.
- Try logging in with a weak password — should be rejected.
- Leave a session idle for >1 hour — should require re-auth.

---

## Layer 7: Backups and breach response

**What to do:**

- **Daily backups:** Supabase Pro plan includes daily automated backups with 7-day retention. Verify this is enabled.
- **Point-in-time recovery:** Available on Supabase Pro. Enables restoring to any second in the past 7 days.

**Breach response plan:**

1. **Detect:** Sentry alerts, reconciliation mismatches, or suspicious audit log entries.
2. **Contain:** Immediately rotate all API keys (Supabase service role, Square access token). Disable affected user accounts.
3. **Assess:** Review `audit_log` for the full scope of unauthorized access. Check which records were accessed or modified.
4. **Notify:** If PII of minors was exposed, notify affected families within 72 hours. If >500 California residents affected, notify the California Attorney General per CCPA.
5. **Remediate:** Patch the vulnerability. Review and tighten RLS policies. Add additional monitoring.
6. **Document:** Write a post-incident report. Update security practices.

**How to verify:**

- Supabase Dashboard → Settings → confirm backup schedule is active.
- Run a test restore in a separate project to verify backups work.

---

## Layer 8: No PII in LLM prompts

**What to do:**

- **Internal rule:** real student names, emails, phone numbers, and dates of birth are never pasted into ChatGPT, Claude, Windsurf, or any AI tool.
- When working with AI agents on this codebase, use only synthetic/seed data.
- The seed script (`supabase/seed.sql`) uses fake data for this purpose.
- If you need to debug a production issue involving real data, anonymize it first.

**How to verify:**

- This is a process rule, not a technical control. Enforce via team discipline.
- Periodically review AI conversation history for accidental PII inclusion.

---

## CCPA compliance checklist

BDC operates in California and handles PII of minors. CCPA applies.

- [ ] **Privacy policy** on the BDC website disclosing what data is collected and why.
- [ ] **Data inventory:** documented list of all PII fields in the schema (customer name, email, phone, DOB, contacts).
- [ ] **Right to know:** process for a parent to request all data held about their child. Query: `select * from customers where id = X` + related tables.
- [ ] **Right to delete:** process to delete a customer and all related records. The `on delete cascade` foreign keys handle this — deleting a `customers` row cascades to contacts, enrollments, attendance, tags, payment methods.
- [ ] **Data retention:** define how long records are kept after a student leaves (recommendation: 7 years for tax purposes, then delete).
- [ ] **No sale of data:** BDC does not sell student data. Document this in the privacy policy.
- [ ] **Parental consent:** for students under 13, obtain verifiable parental consent before collecting data (this happens at enrollment, outside the platform).

---

## Security review checklist (run before each phase goes live)

- [ ] All tables have RLS enabled (`select tablename, rowsecurity from pg_tables where schemaname = 'public';`)
- [ ] No secrets in git history (`git log --all -p | grep -i "service_role\|square_access_token"`)
- [ ] `.env.local` is gitignored
- [ ] `NEXT_PUBLIC_` vars contain only safe-to-expose values
- [ ] Audit log immutability trigger is active (try `update audit_log set action = 'test'` — should fail)
- [ ] Square webhook signature verification is implemented
- [ ] Sentry is configured and receiving test errors
- [ ] Backups are enabled and tested
- [ ] 2FA is enabled for all production admin accounts
