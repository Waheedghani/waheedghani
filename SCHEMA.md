# SARAI ERP — Schema Overview

Authoritative definitions live in `supabase/migrations/` (SQL). This file is
the human map. Conventions: money `NUMERIC(18,4)`, quantities `NUMERIC(14,3)`,
FX rates `NUMERIC(12,6)`, every business table carries
`id uuid PK, created_at/by, updated_at/by`, an audit trigger and RLS.

## Financial core (Phase 1)
| Object | Purpose |
|---|---|
| `accounts` | Chart of accounts. Fixed rows seeded; party/order accounts auto-created with `RANGE-SEQ` codes (D-003). `fixed_currency` pins cash drawers to one currency. |
| `journal_entries` | Double-entry headers. `entry_no` gapless per fiscal year. Status `draft → posted → reversed`. |
| `journal_lines` | One side each (`debit=0 OR credit=0`), per-line `currency`, optional manual `fx_rate`. |
| `journal_counters` | Gapless entry numbering per year. |
| `fn_post_journal(...)` | The ONLY writer of journal rows. Validates balance per currency up front; deferred constraint triggers re-verify at commit. |
| `fn_reverse_entry(id, reason)` | Admin-only mirror reversal (D-005). |
| `v_account_balances` | Net balance per account per currency. |
| `fn_account_balance(acct, ccy, as_of)` | Point-in-time balance. |

**Triggers:** `trg_jl_account_currency` (account exists/active, currency pin,
4-dp scale), `trg_jl_balance` + `trg_je_balance` (deferred: SUM(debit)=SUM(credit)
per currency, ≥2 lines), `trg_je_immutable` + `trg_jl_immutable` (posted rows
frozen), audit + touch everywhere.

## Foundation (Phase 0)
| Object | Purpose |
|---|---|
| `app_users` | Profile per auth user: role `admin/office/warehouse`, warehouse binding enforced by CHECK. |
| `app_current_role()` / `app_is_office()` / `app_is_admin()` / `app_current_warehouse()` | SECURITY DEFINER helpers used inside RLS policies. |
| `doc_counters` + `fn_next_doc_no(prefix, date)` | Gapless per-prefix-per-year document numbers (D-001). |
| `audit_log` + `fn_audit()` | Generic old/new jsonb audit on every business table; append-only (trigger + no grants). |
| `auth_events` + `fn_log_auth_event()` | Login/logout trail. |
| `fn_bootstrap_admin(name)` | First-run admin creation (D-007). |

## Parties & products (Phase 2)
| Object | Purpose |
|---|---|
| `products` / `product_variants` | Oil bottles 5/10/16/20 L, sugar KG + bag (`kg_per_bag` editable). |
| `suppliers` / `warehouses` / `sarafs` | Party master data; ledger `account_id` auto-created by `fn_party_auto_account` trigger (2000 / 1400 / 1500 ranges). Names sync to accounts on rename. Unique names, never deleted (D-011). |

## Purchasing (Phase 3)
`purchase_invoices` + `purchase_invoice_lines` (containers × units/container ×
price, generated `line_total`, container numbers), `supplier_payments`
(advance | settlement, cash | bank). Posting: invoice → DR 1300-order transit /
CR supplier payable; advance → DR payable / CR cash or bank; settlement →
DR payable / CR bank.

## Orders & receiving (Phase 4)
`orders` (trucks/containers/units, doc-no ORD-…), `truck_receipts`
(`qty_received + qty_waste = qty_expected` CHECK), `order_expenses`,
`landed_costs` (auto + editable final cost per unit, jsonb calc snapshot,
lockable), `stock_movements` (signed qty; `warehouse_id NULL` = central).

## Warehouses & dispatch (Phase 5)
`dispatch_invoices` + `dispatch_lines` (stock-availability check on post;
DR receivable / CR revenue + DR COGS / CR inventory), `warehouse_payments`
(cash | saraf, optional hawala no., FX clearing for cross-currency — D-004).

## Sarafs (Phase 6)
`saraf_transactions` (in/out, hawala number, linking to settled documents).

## Roznamcha (Phase 7)
`v_roznamcha` (journal lines touching 1000/1001 + manual entries),
`roznamcha_manual`, `roznamcha_days` (open/close, counted vs computed,
variance must be zero or explained; closed days reject postings).

## Expenses (Phase 8)
`expense_categories` (→ 6000-range accounts), `office_expenses`
(cash | bank | saraf).

## Integrity (Phase 9)
`fn_run_health_checks()` → `data_health_results` (HC-01 … HC-12),
`reconciliations` (saraf / warehouse stock / warehouse money) with documented
adjustment entries.
