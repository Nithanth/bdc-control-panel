# Spec Generation Prompts

Use these prompts in fresh Claude or Claude Code sessions to generate each remaining sub-doc with full focus. Generate one or two per session for best quality. Always upload `docs/README.md` as context first so the generated doc stays consistent with the master vision.

---

## Order of generation (recommended)

Generate in this order — later docs depend on earlier ones being settled:

1. `architecture.md`
2. `schema.sql`
3. `security.md`
4. `square-integration.md`
5. `reliability.md`
6. `modules/classes.md`
7. `phases/phase-1-classes.md`  ← you can start building after this
8. `migration.md`
9. `modules/gigs.md` + `phases/phase-2-gigs.md`
10. `modules/expenses.md` + `modules/reporting.md` + `phases/phase-3-expenses.md`
11. `modules/recitals.md` + `modules/corporate-events.md` + `modules/contracts.md` + `phases/phase-4-other.md`
12. `runbook.md`

---

## Universal preamble (paste before every prompt below)

> I'm building a studio operations platform called BDC Control Panel. Attached is the master README spec. Read it carefully — it defines the vision, architecture, modules, phases, and constraints. Your job is to write ONE sub-doc that fits within this spec. Stay consistent with the README. Do not invent new architecture. Do not contradict decisions already made. If something in the README is unclear or seems wrong, flag it before writing rather than working around it.

---

## Prompt 1 — architecture.md

> Write `docs/architecture.md` (~5 pages). Cover: the rationale for the shared-core-plus-modules pattern, how modules communicate (they don't directly — they share the core tables), why Supabase is the right backend choice, the data flow for a typical billing event end-to-end, the boundary between our system and Square, and the boundary between our system and the user (admin dashboard only). Include a more detailed version of the architecture diagram from the README. No SQL — that lives in schema.sql.

## Prompt 2 — schema.sql

> Write `docs/schema.sql` as runnable Postgres SQL. Include: every core table (customers, contacts, charges, expenses, square_payment_methods, audit_log, tags, users), every Phase 1 module table (enrollments, attendance), all indexes, all foreign keys, all CHECK constraints, ENUM types where appropriate, and RLS policies for every table. Add SQL comments explaining each table and non-obvious column. Use the polymorphic source pattern from the README for charges and expenses. Make audit_log append-only via a trigger that blocks UPDATE and DELETE. Make sure every table has created_at and updated_at with triggers. Use snake_case throughout. The file should be runnable as a Supabase migration.

## Prompt 3 — security.md

> Write `docs/security.md` (~3 pages). Convert the eight security layers from the README into a concrete checklist with implementation notes. For each layer, specify: what to do, how to verify it's done, what to test. Include the actual RLS policy patterns (in SQL) for the common cases: owner-sees-everything, instructor-sees-only-their-students, audit-log-is-read-only-after-insert. Cover CCPA compliance requirements. Cover the secrets management workflow (Vercel env vars + Supabase function secrets). Include the breach response runbook.

## Prompt 4 — square-integration.md

> Write `docs/square-integration.md` (~4 pages). Cover: which Square APIs we use and which we explicitly don't (no Subscriptions). For each API, give a TypeScript code example of the call we'll make, with real parameter shapes. Detail the idempotency key strategy. Detail the webhook subscription list and how each webhook updates our DB. Cover sandbox vs production environment switching. Cover the Web Payments SDK integration for card-on-file capture, including the consent UX. Include the reconciliation job logic in pseudocode.

## Prompt 5 — reliability.md

> Write `docs/reliability.md` (~3 pages). Cover the three pillars (idempotency, audit log, reconciliation) in implementation detail. Include a test suite outline for the billing worker covering all edge cases listed in the README. Cover failure handling: what happens when Square returns an error, when the worker crashes mid-charge, when a webhook is missed. Cover the parallel-run methodology for cutover. Cover monitoring and alerting (Sentry setup, what to alert on).

## Prompt 6 — modules/classes.md

> Write `docs/modules/classes.md` (~4 pages). Detail the recurring classes module: the enrollments table, the attendance table, the billing worker logic in pseudocode, the attendance marking UI flow, the dashboard views (active students, credits remaining, exceptions), how holiday weeks and pauses work, how trial classes are handled separately, how a student moves from trial to package. Include all edge cases.

## Prompt 7 — phases/phase-1-classes.md

> Write `docs/phases/phase-1-classes.md` as an hour-by-hour build plan for Phase 1. Break the work into sessions (e.g., "Saturday morning: Supabase setup and schema migration", "Saturday afternoon: Square sandbox integration"). For each session, list: prerequisites, exact steps, definition of done, common pitfalls. Include the prompts to give Claude Code at each step. End with the parallel-run plan and cutover checklist. This is the doc the owner will actually follow when building.

## Prompts 8–12

(Follow the same pattern. Each prompt: name the file, give the page target, list what to cover, reference the README sections it builds on. Use prompts 1–7 as templates.)

---

## After all docs are generated

Initialize the repo using the structure in README section 11. Drop all generated docs into `docs/`. Commit. Then start Phase 1 by feeding `phases/phase-1-classes.md` to Claude Code.
