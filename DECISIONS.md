# SARAI ERP — Engineering Decisions

A running log of decisions made where the specification left room. Each entry
states the conservative, accounting-correct choice taken.

## D-001 — Document numbers assigned at post time
Draft-capable documents (purchase invoices, dispatch invoices, warehouse
payments, office expenses) receive their gapless `doc_no` when **posted**, not
when drafted. Drafts may legally be deleted; the auditable, gapless series is
the series of posted documents. Documents with no draft stage (orders) are
numbered at creation and cannot be deleted. Counters are per prefix per year
(`doc_counters`), incremented under a row lock inside the posting transaction,
so a rolled-back post rolls the counter back too — no gaps, no duplicates.

## D-002 — Journal entry numbers are gapless per fiscal year
`journal_entries.entry_no` is allocated from `journal_counters` inside
`fn_post_journal`. Fiscal year = calendar year of `entry_date`.

## D-003 — Auto-created party accounts use dotted range codes
The chart ranges (1400 warehouses, 1500 sarafs, 2000 suppliers, 1300 orders,
1100 banks) generate codes like `1400-0001`. A plain numeric range (1400–1499)
would cap the business at 100 warehouses forever; suffixed codes keep the
range semantics, sort correctly, and never exhaust (9,999 per range).

## D-004 — Cross-currency settlements go through an FX clearing account
Journal entries must balance **per currency** (spec §2.3/§4.2), so a payment
in AFN that settles a USD receivable posts two balanced pairs through account
`3900 FX Conversion Clearing` with the manual bazaar rate stored on both legs:
`DR Cash-AFN / CR FX-AFN` and `DR FX-USD / CR Receivable-USD`. Any residue in
3900 is visible FX gain/loss, never hidden.

## D-005 — Immutability escape hatch is a transaction-local flag
The only legal mutation of a posted journal entry is `posted → reversed`,
performed by `fn_reverse_entry` under `app.allow_reversal_mark` (a
transaction-local GUC) with a jsonb equality check proving no other column
changed. Reversals are **admin-only** (spec §8 lists reversals under admin).

## D-006 — fn_post_journal inserts draft → lines → flip to posted
This ordering means the deferred balance guard always evaluates the complete
entry, and the function stays correct even under `SET CONSTRAINTS ALL
IMMEDIATE` (used by tests, or any future code).

## D-007 — Admin bootstrap
`app_users.id` references `auth.users`, so the seed cannot create an admin on
a production project. The first authenticated user calls
`fn_bootstrap_admin(full_name)` — it succeeds only while no active admin
exists. Every later account is created by an admin through User Management.

## D-008 — Supplier payments table
The spec describes advance/settlement postings but no table for them.
`supplier_payments` (kind `advance` | `settlement`, method `cash` | `bank`)
records them as first-class draft→post documents feeding the supplier ledger.

## D-009 — Stock locations and movement types
`stock_movements.warehouse_id NULL` = company central/transit stock. Truck
receipts put goods into central stock; a dispatch writes two rows (−central,
+warehouse). Added movement type `pickup` for buyer collections recorded by
warehouse keepers (spec §1 requires pickup records but the type list omitted
it). Dispatch arrival confirmation by the keeper is informational
(`wh_confirmed_at/by` on the dispatch), not a second stock movement — stock
transfers to the warehouse ledger at dispatch post, matching "the warehouse is
the debtor".

## D-010 — Truck receipts post at the current landed cost
`landed_costs` is auto-created with the order and recomputed as route expenses
arrive; truck receipts post inventory at the **current** final cost per unit.
If expenses arrive after receipts/lock, HC-08 flags the drift for review
rather than silently rewriting posted history.

## D-011 — Parties are never deleted
No DELETE policies or grants on suppliers/warehouses/sarafs — a party with a
ledger cannot vanish. Deactivate instead (`is_active = false`).

## D-012 — Test harness = real PostgreSQL, no Docker
The Supabase CLI/Docker are unavailable on this machine, so SQL verification
runs on `embedded-postgres` (real Postgres 18) with a thin shim that recreates
`auth.users`, `auth.uid()` and the PostgREST role/JWT GUC contract. RLS tests
impersonate users exactly the way PostgREST does (`set_config('role', …)` +
`request.jwt.claims`). Migrations remain 100 % Supabase-compatible: the shim
lives only under `supabase/tests/harness/`.

## D-013 — Warehouse keeper visibility
Warehouse users read their own warehouse row, their stock movements, their
dispatches (header + lines), their payments and their money-ledger view —
nothing else. They can write exactly two things: dispatch arrival
confirmations and buyer pickup records (both scoped to their warehouse by RLS
`WITH CHECK`).

## D-014 — Eastern Arabic digits deferred
All numbers render LTR with Western digits per spec; `fmtMoney`/`fmtQty` are
the single funnel where an Eastern-digits toggle can be added later. Same for
Solar Hijri dates via `lib/dates.ts`.
