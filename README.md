# BDC Control Panel

Admin platform for Bollywood Dance Central. Replaces spreadsheet-based studio operations with automated Square billing, expense tracking, and financial reporting.

**This repo is currently in spec phase.** All design docs live in `docs/`. Start with `docs/README.md`.

## Status

- [x] Master spec written (`docs/README.md`)
- [x] Spec generation prompts ready (`docs/spec-generation-prompts.md`)
- [ ] Sub-docs generated (architecture, schema, security, etc.)
- [ ] Phase 1 build (Classes module)
- [ ] Phase 2 build (Gigs)
- [ ] Phase 3 build (Expenses + Reporting)
- [ ] Phase 4 build (Recitals, Corporate, Contracts)
- [ ] Production cutover

## Stack

- **Frontend:** Next.js 14 + TypeScript + Tailwind + shadcn/ui (in `apps/web/`)
- **Backend:** Supabase (Postgres, Edge Functions, Auth, Storage)
- **Payments:** Square API (Customers, Cards, Payments, Invoices, Webhooks)
- **Hosting:** Vercel (frontend), Supabase Cloud (backend)
- **Errors:** Sentry

## Repo structure

```
docs/                   ← all design docs (start here)
apps/web/               ← Next.js admin dashboard (Phase 1+)
supabase/
  migrations/           ← SQL schema migrations
  functions/            ← Edge Functions (billing worker, webhook receivers)
packages/shared/        ← shared TypeScript types and Square client
tests/billing/          ← billing logic test suite
```

## Setup (once Phase 1 build begins)

1. Clone the repo
2. `cp .env.example .env.local` and fill in Supabase + Square sandbox credentials
3. `npm install`
4. `npx supabase start` (local Supabase via Docker)
5. `npx supabase db push` to apply migrations
6. `npm run dev` in `apps/web/`
7. Open `http://localhost:3000`

## Working with AI agents

This repo is designed for use with Claude Code, Windsurf, and similar agents. Before any build task:

1. Have the agent read `docs/README.md` (always)
2. Plus the relevant module spec from `docs/modules/`
3. Plus the relevant phase plan from `docs/phases/`
4. Plus `docs/security.md` and `docs/reliability.md` for any task touching charges or PII

Hard rules for every agent session:

- Never commit `.env` files or secrets
- Always use idempotency keys on Square API calls
- Always add RLS policies to new Supabase tables
- Always write audit log entries for state changes
- Never use real student data in development — use seeds only
- No Square Subscriptions API — we use Payments + Cards on File

## Security

This system handles PII for minors. See `docs/security.md` for the full security model. Non-negotiables:

- No card data in our database, ever (Square holds it)
- RLS on every table
- 2FA on every admin account
- Daily backups
- No PII in LLM prompts

## License

Private. Proprietary to Bollywood Dance Central.
