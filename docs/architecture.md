# Architecture

This document explains **why** the system is structured the way it is. For the **what**, see the master spec (`README.md`). For the **how** (SQL), see `schema.sql`.

---

## 1. Design principles

1. **Single system of record.** Every dollar in or out of BDC has exactly one row in Postgres. Square is the payment rail; we are the ledger.
2. **Shared core + pluggable modules.** Core tables (`customers`, `charges`, `expenses`, `audit_log`) are used by every module. Each module (Classes, Gigs, Expenses, etc.) owns its own domain tables but writes to the same core tables for money. This means profit reporting is always one query away, regardless of which module generated the revenue.
3. **Database-enforced safety.** RLS, foreign keys, CHECK constraints, and triggers enforce correctness in Postgres — not in application code. The app is a UI layer; the database is the authority.
4. **Idempotency everywhere.** Every write that touches money uses a deterministic idempotency key. Network failures, retries, and cron re-runs can never cause duplicate charges.
5. **Append-only audit trail.** The `audit_log` table cannot be updated or deleted (enforced by trigger). Every state change is recorded permanently.

---

## 2. Why this stack

### Supabase (Postgres + Edge Functions + Auth + Storage)

- **Postgres** is the most battle-tested relational database. RLS is built in. JSON columns handle semi-structured data when needed. Full-text search is available without a separate service.
- **Edge Functions** (Deno-based) run billing workers and webhook receivers without a separate server. They have direct access to the database and secrets.
- **Auth** gives us email/password authentication, JWT tokens, and session management out of the box. No custom auth code. `auth.uid()` in RLS policies ties permissions directly to the logged-in user.
- **Storage** holds receipt images and exported reports. Secured by the same RLS policies.
- **Managed service.** Backups, scaling, and uptime are Supabase's problem. The studio owner doesn't maintain infrastructure.

### Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui

- **Server Components** fetch data server-side with the service role key — no API layer needed between the frontend and Supabase for read operations.
- **Server Actions** handle mutations (create student, mark attendance) with built-in form handling and optimistic updates.
- **TypeScript strict mode** catches bugs at compile time. Every database row has a corresponding TypeScript type.
- **Tailwind + shadcn/ui** gives a clean, professional UI with zero custom CSS. Components are copy-pasted into the repo (not a dependency), so they can be customized freely.

### Square (not Stripe)

- BDC already uses Square for in-person POS. Switching to Stripe would mean migrating all existing customers and cards. Staying with Square avoids that entirely.
- Square's Payments API + Cards on File model fits BDC's consumption-based billing (charge after 4 classes) better than Stripe's subscription-oriented model.
- We explicitly **do not use Square Subscriptions** because they are time-based (monthly), not consumption-based (per-pack-of-4-classes).

### Vercel

- Deploys on every `git push`. No CI/CD configuration.
- Edge network means fast loads for the admin (California-based).
- Environment variables are managed in the Vercel dashboard — no secrets in code.

---

## 3. System boundary diagram

```
┌───────────────────────────────────────────────────────────────┐
│                        ADMIN USER                             │
│                    (browser / tablet)                          │
└──────────────────────┬────────────────────────────────────────┘
                       │ HTTPS
                       ▼
┌───────────────────────────────────────────────────────────────┐
│                   VERCEL (Next.js 14)                         │
│                                                               │
│  ┌─────────────────┐  ┌──────────────────┐                    │
│  │ Server          │  │ Client           │                    │
│  │ Components      │  │ Components       │                    │
│  │ (data fetching, │  │ (forms,          │                    │
│  │  server actions)│  │  interactions)   │                    │
│  └────────┬────────┘  └────────┬─────────┘                    │
│           │                    │                              │
│           │  service_role      │  anon key                    │
│           │  (server only)     │  (browser safe)              │
└───────────┼────────────────────┼──────────────────────────────┘
            │                    │
            ▼                    ▼
┌───────────────────────────────────────────────────────────────┐
│                      SUPABASE CLOUD                           │
│                                                               │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────┐     │
│  │  Postgres     │  │ Edge          │  │ Auth           │     │
│  │              │  │ Functions     │  │                │     │
│  │ • Core tables│  │ • billing     │  │ • email/pass   │     │
│  │ • Module     │  │   worker      │  │ • JWT tokens   │     │
│  │   tables     │  │ • webhook     │  │ • 2FA (future) │     │
│  │ • RLS on     │  │   receiver    │  │                │     │
│  │   everything │  │ • reconciler  │  │                │     │
│  │ • Audit log  │  │               │  │                │     │
│  └──────────────┘  └──────┬────────┘  └────────────────┘     │
│                           │                                   │
│  ┌──────────────┐         │                                   │
│  │ Storage      │         │                                   │
│  │ (receipts,   │         │                                   │
│  │  exports)    │         │                                   │
│  └──────────────┘         │                                   │
└───────────────────────────┼───────────────────────────────────┘
                            │ HTTPS
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                      SQUARE API                               │
│                                                               │
│  Customers · Cards on File · Payments · Invoices · Webhooks   │
│                                                               │
│  Square is the payment rail and card vault.                   │
│  We never see or store card numbers.                          │
└───────────────────────────────────────────────────────────────┘
```

---

## 4. Data flow: a typical billing event

Here is the end-to-end flow for the most common operation — auto-charging a student after their 4th class:

### Step 1: Attendance is marked
- Admin taps "Present" on the dashboard for a student in a class.
- A **Server Action** inserts a row into `attendance` and writes to `audit_log`.
- The student's unbilled class count increments.

### Step 2: Billing worker runs
- A **Supabase Edge Function** runs on a cron schedule (e.g., nightly or on-demand).
- It queries: "Which students have ≥ 4 unbilled attendance records?"
- For each qualifying student, it:
  1. Looks up their `square_payment_methods` row to get the Square `customer_id` and `card_id`.
  2. Computes a deterministic **idempotency key**: `class-{student_id}-pack-{pack_number}`.
  3. Calls Square's `CreatePayment` API with that key.

### Step 3: Square processes the payment
- Square charges the card on file.
- Returns a `payment_id` and status (`COMPLETED`, `FAILED`, etc.).

### Step 4: Result is recorded
- The billing worker inserts a row into `charges` with `source_module = 'classes'`, the Square `payment_id`, and the status.
- The 4 attendance rows are marked as `billed = true`.
- An `audit_log` entry records the charge event.
- If the charge **failed** (expired card, insufficient funds), a row is inserted into an exceptions queue for the admin to resolve.

### Step 5: Webhook confirms (belt and suspenders)
- Square sends a `payment.updated` webhook to our **Edge Function** webhook receiver.
- The receiver verifies the signature, finds the matching `charges` row, and updates the status if it differs.
- Another `audit_log` entry records the webhook update.

### Step 6: Reconciliation (nightly safety net)
- A separate **Edge Function** runs nightly.
- It pulls all Square transactions from the past 24 hours via the Square API.
- It compares them to `charges` rows in the same period.
- Any mismatch (missing charge, status discrepancy, unknown transaction) fires an alert to the admin.

---

## 5. The polymorphic charges/expenses pattern

The key design decision: **one `charges` table for all revenue, one `expenses` table for all costs.** Each row is tagged with which module it came from.

```sql
-- Every dollar IN
charges.source_module  → 'classes' | 'gigs' | 'recitals' | 'corporate' | 'contracts' | 'manual'
charges.source_id      → the specific enrollment, gig, recital, event, or contract

-- Every dollar OUT
expenses.allocated_to_module → 'classes' | 'gigs' | 'recitals' | 'corporate' | 'contracts' | 'overhead'
expenses.allocated_to_id     → the specific event/contract, or NULL for overhead
```

This means:
- **Profit for any gig** = `SUM(charges WHERE source_module='gigs' AND source_id=X)` minus `SUM(expenses WHERE allocated_to_module='gigs' AND allocated_to_id=X)`
- **Monthly profit** = `SUM(charges in month)` minus `SUM(expenses in month)`
- **Overhead burden** = expenses with `allocated_to_module = 'overhead'`

No joins needed. No separate revenue tables per module. One pattern, works everywhere.

---

## 6. Module communication

Modules **do not communicate directly with each other.** They share the core tables.

- The Classes module writes to `charges` when it bills a student.
- The Gigs module writes to `charges` when it bulk-charges participants.
- The Expenses module writes to `expenses` when costs are logged.
- The Reporting module **reads** from `charges` and `expenses` across all modules.

There are no inter-module API calls, event buses, or message queues. Postgres is the integration layer. This keeps the system simple and queryable.

---

## 7. Auth and access model

### Current (v1): admin-only

- All users are admins (owner or staff). There are no student/parent accounts.
- Supabase Auth handles email/password login and JWT tokens.
- `app_users` table maps each `auth.users` row to an `app_role` (owner, admin, instructor).
- RLS policies use `auth.uid()` to scope data access.
- The owner role has full access. The admin role has full access minus user management. The instructor role (future) will be scoped to their own classes.

### Future (v2+): parent portal

- If a parent portal is added, it will be a separate Next.js app with its own Supabase Auth configuration.
- Parent accounts will have extremely limited RLS policies — they can only see their own children's attendance and charge history.
- This is out of scope for v1.

---

## 8. Edge Functions architecture

Three categories of Edge Functions:

### Workers (cron-triggered)
- **Billing worker** — runs on schedule, processes unbilled attendance into charges.
- **Reconciliation worker** — runs nightly, compares our charges to Square transactions.

### Webhook receivers (HTTP-triggered)
- **Square webhook receiver** — receives `payment.updated`, `card.updated`, `invoice.payment_made`, `dispute.*` events from Square. Verifies signature, updates our DB.

### On-demand (called from the dashboard)
- **Bulk charge** — triggered when the admin clicks "charge all participants" on a gig. Processes charges in sequence with idempotency keys.

All Edge Functions use the `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS when performing system operations (billing, webhooks). They never expose this key to the browser.

---

## 9. Error handling strategy

| Scenario | Handling |
|---|---|
| Square API returns error on charge | Record failure in `charges` table with error details. Add to exceptions queue. Admin resolves manually. |
| Billing worker crashes mid-batch | Idempotency keys ensure no double-charges on restart. Worker picks up where it left off. |
| Webhook missed or delayed | Nightly reconciliation catches any discrepancy. |
| Database write fails | Supabase retries. If persistent, Sentry alert fires. |
| Admin browser disconnects mid-action | Server Actions are atomic — they either complete or don't. No partial state. |
| Card expired | Square returns specific error code. Student is flagged in exceptions panel. Admin contacts parent. |

---

## 10. What this architecture does NOT include

Keeping the architecture simple by explicitly excluding:

- **No message queue** (Kafka, RabbitMQ, etc.) — Postgres + cron is sufficient for our volume.
- **No microservices** — everything is one Supabase project + one Next.js app.
- **No GraphQL** — Supabase's auto-generated REST API + direct Postgres queries are simpler.
- **No Redis / caching layer** — the admin dashboard serves 1-5 concurrent users, not thousands.
- **No CDN for the dashboard** — Vercel's edge network is sufficient.
- **No separate API server** — Next.js Server Components and Server Actions replace the need for an Express/Fastify backend.
