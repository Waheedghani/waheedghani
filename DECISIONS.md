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

## D-015 — Landed-cost / waste reconciliation model
The spec's postings ("route expense: DR 5100 / CR cash" and "truck received:
DR Inventory / CR Transit at landed cost"; "waste: DR 5200 / CR Transit")
cannot all hold at face value — transit would never drain to zero. The model
that satisfies every stated posting AND nets exactly:
`L = (c·denom + E) / denom` where `denom = expected − waste`, waste is
expensed to 5200 **at invoice unit cost c**, transit is relieved at `c`, and
the expense share `r·(L−c)` is credited to `5190 Import Expenses Capitalized`
(contra to the 5100s). Waste still inflates L because E spreads over fewer
units; the 4-dp rounding remainder lands in 5190, never lost. Verified exact
in phase-4 tests (transit = 0.0000 after full receipt).

## D-016 — FX rate semantics
`fx_rate` is always **AFN per 1 USD** (the bazaar quote). AFN→USD divides,
USD→AFN multiplies. One rule everywhere; the rate is stored on every
cross-currency line.

## D-017 — Stock levels are a plain view
`v_stock_levels` is a live view over `stock_movements` (not materialized) —
it cannot drift, so HC-03 checks only the business rule (no negative stock),
not view staleness. All views are `security_invoker = true` so RLS of the
querying user always applies.

## D-018 — 'payable' route expenses
Route expenses with `paid_via = 'payable'` credit the **order's supplier**
payable account (freight billed by the supplier). Third-party freight
creditors would be a new party type — out of v1 scope.

## D-019 — Central inventory cost pool: moving average per variant/currency
`stock_movements` carries `unit_cost`/`cost_currency` for company stock:
receives at landed cost, dispatches at the pool's moving-average cost. COGS
posts in the pool's currency. If one variant's central stock ever holds value
in two currencies, dispatch posting is blocked with a clear error until
reconciled — mixing currencies in one average would fabricate numbers.

## D-020 — Manual Roznamcha entries offset equity
A manual drawer entry has no source document, but double-entry demands a
balanced posting. Manual cash in/out posts against `3000 Opening Balances /
Equity` (owner injections and drawings). The description and bill refs carry
the business detail; nothing ever hits the drawer unbalanced.

## D-021 — Saraf-paid office expenses and warehouse payments auto-register
Any money that moves through a saraf (warehouse payment via hawala, office
expense paid by the saraf) automatically writes a **linked, posted**
`saraf_transactions` row (the hawala register). Linked rows carry no journal
of their own — the source document's entry is the ledger truth — and cannot
be posted independently.

## D-014 — Eastern Arabic digits deferred
All numbers render LTR with Western digits per spec; `fmtMoney`/`fmtQty` are
the single funnel where an Eastern-digits toggle can be added later. Same for
Solar Hijri dates via `lib/dates.ts`.
