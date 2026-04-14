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

## Prerequisites

- Node.js 18+
- npm
- A free [Supabase](https://supabase.com) account (cloud — no Docker needed)

## Local development setup

### 1. Create a Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a new project
2. Pick any name and a strong database password (save it somewhere)
3. Wait for the project to finish provisioning (~1 min)

### 2. Get your API keys

1. In the Supabase Dashboard, go to **Settings → API**
2. Copy the **Project URL** and **anon (public)** key
3. Paste them into `apps/web/.env.local` (the file already exists with placeholders)
4. Also copy the **service_role (secret)** key into the same file

### 3. Apply the database schema

1. In the Supabase Dashboard, go to **SQL Editor**
2. Open `supabase/migrations/0001_init.sql` from this repo, copy the contents, paste into the SQL Editor, and click **Run**

### 4. Seed the test admin user

1. In the Supabase Dashboard, go to **Authentication → Users → Add user → Create new user**
2. Email: `admin@bollywooddancecentral.com`, Password: `password123`, check **Auto Confirm User**
3. Copy the user's UUID from the users list
4. Go to **SQL Editor** and run (replacing the UUID):
   ```sql
   insert into public.app_users (id, email, role)
   values ('<paste-uuid-here>', 'admin@bollywooddancecentral.com', 'owner');
   ```

### 5. Run the app

```bash
cd apps/web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with `admin@bollywooddancecentral.com` / `password123`.

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
