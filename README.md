# SARAI ERP — Waheed Ghani

Dual-currency (AFN ؋ / USD $), bilingual (English / پښتو), double-entry ERP
for a cooking-oil & sugar import-distribution business (Malaysia →
Afghanistan).

## Stack
- **Database:** Supabase (Postgres 15+), plpgsql posting functions, triggers,
  Row Level Security. All schema in `supabase/migrations/`.
- **Frontend:** Next.js (App Router) + TypeScript strict + Tailwind CSS,
  TanStack Table/Query, react-hook-form + zod, decimal.js (display math only).

## Getting started
```bash
npm install
copy .env.example .env.local   # fill in your Supabase project URL + anon key
npm run dev
```

Apply migrations to your Supabase project (in order) with the Supabase CLI:
```bash
supabase link --project-ref <ref>
supabase db push          # applies supabase/migrations/*
# then run supabase/seed.sql against the project (SQL editor or psql)
```

**First run:** create your own auth user (Supabase Auth → email/password),
sign in to the app, and it will offer the one-time administrator setup
(`fn_bootstrap_admin`). Every further user is created by the admin in
Administration → Users.

## Verification
```bash
npm run typecheck   # tsc --noEmit
npm run lint
npm run db:test     # boots a REAL embedded PostgreSQL cluster (no Docker),
                    # applies every migration + seed, runs all SQL tests:
                    # journal balance/immutability, RLS isolation, posting
                    # functions, health checks, and the million-dollar
                    # end-to-end scenario
```

## Non-negotiables encoded in the database
- Money is `NUMERIC(18,4)`; **no float anywhere** (`grep` the migrations).
- Every financial event is a balanced journal entry — a trigger rejects
  unbalanced postings **per currency** at commit.
- Posted documents are immutable; corrections are reversal entries.
- Roznamcha shows **physical drawer cash only**; sarafs have separate ledgers.
- Warehouse (سرای) users are isolated to their own warehouse by RLS in
  Postgres, not by UI.
- Full audit trail (`audit_log`, append-only) on every business table.

See `DECISIONS.md` for engineering decisions and `SCHEMA.md` for the schema map.
