# BDC Control Panel — Master Spec

**Owner:** Bollywood Dance Central
**Purpose:** Replace spreadsheet-based studio operations with a modular admin platform that automates Square billing, tracks all revenue and expenses, and produces accurate financial reporting.
**Status:** Spec v0.1 — pre-build
**Audience:** The studio owner (you), and AI coding agents (Claude Code, Windsurf) building the system.

---

## 1. Vision

A single admin-only web application — the "control panel" — that replaces every operational spreadsheet currently used to run BDC. It is the system of record for students, classes, attendance, gigs, events, contracts, expenses, and all money in and out of the business. Square remains the payment rail and the financial source of truth for card transactions; the control panel orchestrates *when* charges fire and tracks *everything* Square doesn't (expenses, gigs, contracts, attendance, profit).

The product the owner experiences:
- Log in → see dashboard of active students, upcoming charges, exceptions, weekly cash flow.
- Mark attendance on a tablet → charges fire automatically when students complete 4 classes.
- Create a gig (Spurs, Warriors, parade) → tag participating students → click one button to bulk-charge them.
- Log expenses against gigs → see real per-gig profitability.
- Track government contracts and corporate events that never touch Square.
- Generate weekly/monthly/yearly profit reports across all revenue streams.
- Never open a spreadsheet again.

The non-negotiables:
- **100% accuracy** on all charges. Reputation depends on it.
- **Zero PII leakage**. Student data (especially minors) is protected by every layer the stack offers.
- **No card data** ever touches our database. Square holds it; we hold opaque tokens.
- **Admin-only access**. No public-facing student or parent portals in v1. The owner and a small number of authorized staff are the only users.

---

## 2. Architecture at a glance

```
┌─────────────────┐
│  Next.js admin  │  ← admin-only, deployed on Vercel
│   dashboard     │     bdc-admin.yourdomain.com
└────────┬────────┘
         │
         │  Supabase JS client
         ▼
┌─────────────────────────────────────┐
│           Supabase                  │
│  ┌────────────┐  ┌──────────────┐   │
│  │ Postgres   │  │ Edge         │   │
│  │ (system of │  │ Functions    │   │
│  │  record)   │  │ (workers,    │   │
│  │            │  │  webhooks)   │   │
│  └────────────┘  └──────┬───────┘   │
│  ┌────────────┐         │           │
│  │ Auth       │         │           │
│  │ (admin)    │         │           │
│  └────────────┘         │           │
│  ┌────────────┐         │           │
│  │ Storage    │         │           │
│  │ (receipts) │         │           │
│  └────────────┘         │           │
└─────────────────────────┼───────────┘
                          │
                          │  HTTPS
                          ▼
                  ┌───────────────┐
                  │  Square API   │
                  │  Customers    │
                  │  Cards        │
                  │  Payments     │
                  │  Invoices     │
                  │  Webhooks     │
                  └───────────────┘
```

**Stack:**
- **Database & backend:** Supabase (Postgres + Edge Functions + Auth + Storage + Realtime)
- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui
- **Hosting:** Vercel (frontend), Supabase Cloud (everything else)
- **Payments:** Square (Customers, Cards, Payments, Invoices, Webhooks)
- **Error tracking:** Sentry
- **Domain:** subdomain of `bollywooddancecentral.com` linked from main site

---

## 3. The seven modules

The platform is structured as a **shared core + pluggable modules**. Core tables are used by every module; each module owns its own tables and logic for its domain.

| Module | Owns | Talks to Square? | Phase |
|---|---|---|---|
| **Classes** (recurring) | enrollments, attendance, billing worker | Yes — auto-charge cards on file | Phase 1 |
| **Gigs** | gigs, gig_participants, gig-scoped expenses | Yes — bulk-charge participants | Phase 2 |
| **Expenses** | expenses, vendors, recurring expense templates | No | Phase 3 |
| **Reporting** | (read-only views over everything) | No | Phase 3 |
| **Recitals** | recitals, registrations, costume orders | Yes — auto-charge | Phase 4 |
| **Corporate Events** | events, quotes, milestones | Yes — Square Invoices | Phase 4 |
| **Contracts** (gov, B2B) | contracts, milestones, manual payments | **No** — pure bookkeeping | Phase 4 |

Plus a **Manual Entries** escape hatch in core for any income or expense that doesn't fit a module.

See `architecture.md` for the full architecture rationale and `modules/*.md` for per-module specs.

---

## 4. Core data model (overview)

The schema is built on a polymorphic `charges` and `expenses` pattern so every dollar in or out of the business has one row, tagged with which module/event it belongs to. This makes profit reporting one SQL query away for any time window or any slice.

**Core tables** (every module uses these):
- `customers` — generalizes "student" to also include companies, government agencies, brides, etc.
- `contacts` — humans attached to a customer (parent, AP rep, bride, etc.)
- `charges` — every dollar in. Polymorphic via `source_module` + `source_id`.
- `expenses` — every dollar out. Polymorphic via `allocated_to_module` + `allocated_to_id`.
- `square_payment_methods` — opaque references to cards on file in Square. Never card numbers.
- `audit_log` — append-only record of every state change. Cannot be updated or deleted.
- `tags` — flags on customers (e.g., "performing_spurs_2025_11_15") used for bulk actions.
- `users` — admin staff with role-based access.

**Per-module tables** are documented in each module's spec.

The full SQL schema (with indexes, constraints, RLS policies) lives in `schema.sql`.

---

## 5. Square integration model

Square's role: payment rail, card vault, financial source of truth for card transactions.
Our role: decide *when* to charge, tell Square to do it, record the result.

**Square objects we use:**
- **Customers API** — one Square customer per BDC student (or corporate client)
- **Cards on File** — captured at signup via Web Payments SDK; we store only `customer_id` + `card_id`
- **Payments API** — `CreatePayment` with idempotency keys for all auto-charges and bulk charges
- **Invoices API** — for corporate events that need NET terms instead of card-on-file
- **Webhooks** — `payment.updated`, `card.updated`, `invoice.payment_made`, `dispute.*` flow back to keep our DB honest

**What we never do:**
- Use Square Subscriptions (time-based, doesn't fit consumption billing)
- Touch card numbers, CVVs, or expiry dates
- Store card data in our DB

**Idempotency:** every `CreatePayment` call uses a deterministic key (`student-{id}-pack-{n}`) so retries can never double-charge.

**Reconciliation:** a nightly job pulls every Square transaction from the prior 24 hours and compares to our `charges` table. Any mismatch fires an alert. This is the safety net.

See `square-integration.md` for full API patterns, idempotency strategy, and webhook handling.

---

## 6. Security & PII protection

Eight layers, all enforced from day one:

1. **Don't store what we don't need.** No SSNs, no card numbers, minimal medical info.
2. **Encryption at rest** (Supabase default) + TLS in transit + `pgsodium` column encryption for especially sensitive fields.
3. **Row-Level Security (RLS) on every table.** Enforced in the database, not the app. RLS is on by default for v1 and never turned off.
4. **Least privilege roles.** Owner has full access; instructors (if added later) have scoped access only.
5. **Secrets in Vercel and Supabase env vars.** Never in code, never in git, never in the frontend bundle.
6. **2FA mandatory** for all admin accounts. Strong password requirements. Session timeouts.
7. **Daily backups** (Supabase Pro) + a documented breach response plan.
8. **No PII in LLM prompts.** Internal rule: real student data never goes into ChatGPT/Claude/etc. Synthetic data only for AI-assisted work.

Plus: **CCPA compliance** (California). Privacy policy on the website. Documented data retention. Right-to-delete process.

See `security.md` for the full checklist and the RLS policy SQL.

---

## 7. Reliability & accuracy guarantees

Three pillars that make the system trustworthy at the level your reputation requires:

1. **Idempotency on every charge.** Cannot double-charge under any failure mode.
2. **Append-only audit log.** Every state change is recorded immutably. Full forensic trail for any dispute, refund, or tax question.
3. **Nightly reconciliation against Square.** Mismatches fire alerts within hours, not weeks. The system can prove its own correctness.

Plus:
- **Test suite for billing logic** written before implementation. Every edge case (early enrollment, holiday weeks, paused students, refunds, expired cards) has a test.
- **Parallel-run period** before cutover: run the new system alongside the spreadsheet for 2 weeks with a small student group, compare every charge, only cut over after zero discrepancies.
- **Sandbox environment** mirroring production, used for all development and testing. Production keys never touch development.

See `reliability.md` for the test suite outline and reconciliation job spec.

---

## 8. Build phases

The platform is built in four phases. Each phase ships independently and adds value on its own. The owner can stop adopting after any phase if they choose; everything from previous phases keeps working.

### Phase 1 — Classes module (the spreadsheet replacement)
**Goal:** retire the Enrollment Tracker spreadsheet. All recurring class students managed in the new system. Auto-charge fires when students hit 4 attended classes.

**Deliverables:**
- Supabase project + schema (core + classes module tables)
- Square sandbox integration: customer creation, card-on-file capture, `CreatePayment`
- Billing worker (Edge Function on a cron) that counts unbilled attendance and fires charges
- Admin dashboard: student list, attendance marking, charge history, exceptions
- Webhook receiver for `payment.updated` and `card.updated`
- Audit log + reconciliation job
- Migration of existing Enrollment Tracker data
- 2-week parallel-run period
- Production cutover

**Timeline:** ~1 weekend for sandbox v1, ~3–4 weeks of evening work to harden, ~2 weeks parallel run, then cutover. Total ~6–8 weeks of part-time work.

See `phases/phase-1-classes.md` for the hour-by-hour build plan.

### Phase 2 — Gigs module + tagging
**Goal:** manage Spurs/Warriors/parade/festival performances. Tag students as participating, bulk-charge fees against cards on file.

**Deliverables:**
- Gigs tables, gig participants tagging
- Bulk charge UI: "charge all participants of Spurs Nov 15 the $45 fee"
- Gig-scoped expense entry (foreshadowing Phase 3)
- Per-gig view with participants, fees collected, status

**Timeline:** ~1–2 weeks of evening work after Phase 1 ships.

See `phases/phase-2-gigs.md`.

### Phase 3 — Expenses + Reporting
**Goal:** track every expense (allocated to gigs, recitals, contracts, or overhead) and produce real profit reporting. This is when the platform becomes a true financial system.

**Deliverables:**
- Expenses module with vendor tracking, receipt storage, allocation to modules/events
- Recurring expense templates (rent, insurance, software)
- Reporting module with: profit by gig, profit by month, profit by module, overhead burden, outstanding receivables
- CSV/PDF exports for tax season

**Timeline:** ~1–2 weeks after Phase 2.

See `phases/phase-3-expenses.md`.

### Phase 4 — Recitals, Corporate Events, Contracts
**Goal:** every remaining revenue stream lives in the platform. The spreadsheets are fully retired.

**Deliverables:**
- Recitals module: registrations, costume orders, fees, bulk charging
- Corporate Events module: quotes, deposits, Square Invoices, milestones
- Contracts module: pure bookkeeping for government and B2B contracts that never touch Square (manual ACH/check entry)

**Timeline:** ~2–4 weeks total, depending on complexity of existing flows.

See `phases/phase-4-other.md`.

---

## 9. Migration plan

Migration runs throughout the project, not at the end. Each phase migrates its own data.

**Phase 1 migration:**
- Transform `Enrollment Tracker` sheet (wide format: 57 date columns) into long-format `attendance` rows
- Import `students` from row metadata (cols 1–10)
- Capture cards on file for existing students (one-time email campaign with secure capture link)
- Import historical Square payments to populate `charges` history
- Validate: spot-check 20+ students, verify totals match spreadsheet

**Phases 2–4 migration:** per-module imports from the relevant existing sheets (Diwali, recital billing, gig rosters, etc.).

See `migration.md` for the full transformation specs and validation checklists.

---

## 10. Operational runbook

Once live, the daily/weekly/monthly cadence is documented so the platform runs predictably.

**Daily (~5 min):**
- Check exceptions panel: failed charges, cards expiring, students missing card on file
- Resolve any red items

**Weekly (~15 min):**
- Review reconciliation report (should always be zero discrepancies)
- Review weekly cash flow
- Log any expenses paid out of pocket

**Monthly (~30 min):**
- Review per-module profitability
- Pay any outstanding manual invoices (gov contracts)
- Backup verification

**Tax season:**
- Export charges and expenses by category
- Reconcile against Square's annual reports
- Hand off to bookkeeper

See `runbook.md` for the full operational guide.

---

## 11. Repository structure

```
bdc-control-panel/
├── docs/                        ← this spec
│   ├── README.md                ← you are here
│   ├── architecture.md
│   ├── schema.sql
│   ├── security.md
│   ├── square-integration.md
│   ├── reliability.md
│   ├── migration.md
│   ├── runbook.md
│   ├── modules/
│   │   ├── classes.md
│   │   ├── gigs.md
│   │   ├── expenses.md
│   │   ├── reporting.md
│   │   ├── recitals.md
│   │   ├── corporate-events.md
│   │   └── contracts.md
│   └── phases/
│       ├── phase-1-classes.md
│       ├── phase-2-gigs.md
│       ├── phase-3-expenses.md
│       └── phase-4-other.md
├── apps/
│   └── web/                     ← Next.js admin dashboard
│       ├── app/
│       ├── components/
│       ├── lib/
│       └── package.json
├── supabase/
│   ├── migrations/              ← SQL schema migrations
│   ├── functions/               ← Edge Functions (workers, webhooks)
│   └── config.toml
├── packages/
│   └── shared/                  ← shared TypeScript types, Square client
├── tests/
│   └── billing/                 ← billing logic test suite
├── .env.example
├── .gitignore
├── README.md                    ← repo-level readme (setup instructions)
└── package.json
```

---

## 12. How to use this spec with coding agents

This spec is designed for use with Claude Code, Windsurf, or similar agents. The structure (one master doc + focused sub-docs) is optimized for agent context windows.

**To start a build task:**
1. Open the relevant phase doc (e.g., `phases/phase-1-classes.md`)
2. Have the agent read: this README + `architecture.md` + `schema.sql` + the relevant module spec + the phase doc
3. Give the agent the specific task from the phase doc
4. Reference `security.md` and `reliability.md` whenever the task touches charges, PII, or auth

**Agent guardrails to enforce in every session:**
- Never commit secrets or `.env` files
- Always use idempotency keys on Square API calls
- Always add RLS policies to new tables
- Always add audit log entries for state changes
- Write tests for billing logic before implementation
- No real student data in development; use seed data only

See `spec-generation-prompts.md` for the prompts to generate each remaining sub-doc in fresh sessions.

---

## 13. What's explicitly NOT in scope

To prevent scope creep, these are deliberately out of scope for the platform:

- **Public-facing student/parent portal** — admin-only in v1. Parent self-service is v2+.
- **Mobile app** — the admin dashboard is responsive but there's no native app.
- **Class scheduling / calendar management** — not solving this. Classes happen on a known schedule maintained outside the system.
- **Email marketing / mass communications** — use existing tools (Mailchimp, etc.). The platform exposes data but doesn't send marketing emails.
- **Inventory / merchandise** — use Square POS for T-shirts, water bottles, etc. Pull totals via Square API into reporting.
- **Payroll** — use existing payroll provider. Instructor pay is logged as expenses, not processed.
- **Accounting software replacement** — this is operational and reporting, not double-entry accounting. Export to QuickBooks if a CPA needs it.
- **Multi-studio support** — single-tenant. If BDC ever opens a second location, that's a v2 conversation.

---

## 14. Definition of done

The platform is "done" (v1, Phase 1–4 complete) when:

1. Every recurring class student is in the database with a valid card on file
2. Attendance is marked through the dashboard, never the spreadsheet
3. Auto-charges fire correctly with zero discrepancies for 30 consecutive days
4. Every gig, recital, and event is created and managed in the platform
5. Every expense is logged and allocated correctly
6. Monthly profit reports are accurate and trusted
7. Government contract bookkeeping happens entirely in the platform
8. The owner spends less than 30 minutes per day on operational admin
9. Tax season export takes less than an hour
10. Zero PII incidents

---

## Next steps

1. Review this README. Flag anything that doesn't match the vision.
2. In a fresh Claude session, use `spec-generation-prompts.md` to generate the sub-docs one at a time.
3. Once all sub-docs exist, initialize the repo from the structure in section 11.
4. Begin Phase 1 build using `phases/phase-1-classes.md` as the guide.
