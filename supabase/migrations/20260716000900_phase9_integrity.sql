-- ============================================================================
-- SARAI ERP — Phase 9: Data health & reconciliation
-- fn_run_health_checks() writes one data_health_results row per check
-- (HC-01 … HC-12) with severity and a drill-down list of offending rows.
-- Reconciliations: saraf money, warehouse money, warehouse/central stock —
-- documented variances, optional adjustment postings, full linkage.
-- ============================================================================

CREATE TABLE data_health_results (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_at     timestamptz NOT NULL DEFAULT now(),
  run_id     uuid NOT NULL,
  check_code text NOT NULL,
  severity   text NOT NULL CHECK (severity IN ('ok', 'warning', 'critical')),
  title      text NOT NULL,
  details    jsonb NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_dhr_run ON data_health_results (run_id);
CREATE INDEX idx_dhr_code ON data_health_results (check_code, run_at);

-- ---------------------------------------------------------------------------
-- fn_run_health_checks — runnable on demand (admin) and by pg_cron nightly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_run_health_checks()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_run uuid := gen_random_uuid();
  v_bad jsonb;
  v_n   int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT app_is_admin() THEN
    RAISE EXCEPTION 'only an admin may run health checks';
  END IF;

  ------------------------------------------------------------------ HC-01
  -- Every posted/reversed journal entry balances per currency
  SELECT jsonb_agg(j), count(*) INTO v_bad, v_n FROM (
    SELECT jsonb_build_object('entry_id', e.id, 'entry_no', e.entry_no,
             'fiscal_year', e.fiscal_year, 'currency', l.currency,
             'debits', sum(l.debit), 'credits', sum(l.credit)) AS j
      FROM journal_entries e
      JOIN journal_lines l ON l.entry_id = e.id
     WHERE e.status IN ('posted', 'reversed')
     GROUP BY e.id, e.entry_no, e.fiscal_year, l.currency
    HAVING sum(l.debit) <> sum(l.credit)
     LIMIT 50) q;
  INSERT INTO data_health_results (run_id, check_code, severity, title, details)
  VALUES (v_run, 'HC-01', CASE WHEN v_n > 0 THEN 'critical' ELSE 'ok' END,
          'Posted journal entries balance per currency', coalesce(v_bad, '[]'));

  ------------------------------------------------------------------ HC-02
  -- Every warehouse has a receivable account; balances recompute identically
  SELECT jsonb_agg(j), count(*) INTO v_bad, v_n FROM (
    SELECT jsonb_build_object('warehouse_id', w.id, 'name', w.name,
                              'problem', 'missing ledger account') AS j
      FROM warehouses w WHERE w.account_id IS NULL
    UNION ALL
    SELECT jsonb_build_object('warehouse_id', w.id, 'name', w.name,
                              'currency', b.currency, 'view_balance', b.balance,
                              'recomputed', fn_account_balance(w.account_id, b.currency),
                              'problem', 'balance drift')
      FROM warehouses w
      JOIN v_account_balances b ON b.account_id = w.account_id
     WHERE b.balance <> fn_account_balance(w.account_id, b.currency)
     LIMIT 50) q;
  INSERT INTO data_health_results (run_id, check_code, severity, title, details)
  VALUES (v_run, 'HC-02', CASE WHEN v_n > 0 THEN 'critical' ELSE 'ok' END,
          'Warehouse money ledgers equal their journal balances', coalesce(v_bad, '[]'));

  ------------------------------------------------------------------ HC-03
  -- No negative stock anywhere (central or warehouse)
  SELECT jsonb_agg(j), count(*) INTO v_bad, v_n FROM (
    SELECT jsonb_build_object('variant_id', s.variant_id,
             'warehouse_id', s.warehouse_id, 'qty', s.qty) AS j
      FROM v_stock_levels s WHERE s.qty < 0 LIMIT 50) q;
  INSERT INTO data_health_results (run_id, check_code, severity, title, details)
  VALUES (v_run, 'HC-03', CASE WHEN v_n > 0 THEN 'critical' ELSE 'ok' END,
          'No negative stock per variant per location', coalesce(v_bad, '[]'));

  ------------------------------------------------------------------ HC-04
  -- Order truck math: expected = received + waste + remaining, remaining >= 0
  SELECT jsonb_agg(j), count(*) INTO v_bad, v_n FROM (
    SELECT jsonb_build_object('order', o.doc_no, 'expected', o.qty_expected,
             'received', o.qty_received, 'waste', o.qty_waste,
             'remaining', o.qty_remaining, 'status', o.status) AS j
      FROM v_order_status o
     WHERE o.qty_remaining < 0
        OR (o.status IN ('received', 'closed') AND o.qty_remaining <> 0)
        OR (o.status IN ('open', 'partially_received') AND o.qty_remaining = 0 AND o.qty_received > 0)
     LIMIT 50) q;
  INSERT INTO data_health_results (run_id, check_code, severity, title, details)
  VALUES (v_run, 'HC-04', CASE WHEN v_n > 0 THEN 'critical' ELSE 'ok' END,
          'Order quantities: expected = received + waste + remaining', coalesce(v_bad, '[]'));

  ------------------------------------------------------------------ HC-05
  -- Posted purchase invoices: advance + bank due = total; lines sum = total
  SELECT jsonb_agg(j), count(*) INTO v_bad, v_n FROM (
    SELECT jsonb_build_object('invoice', i.doc_no,
             'advance', i.advance_payment, 'bank_due', i.bank_balance_due,
             'total', i.total_amount, 'lines_total', t.s) AS j
      FROM purchase_invoices i
      JOIN LATERAL (SELECT coalesce(sum(line_total), 0) AS s
                      FROM purchase_invoice_lines WHERE invoice_id = i.id) t ON true
     WHERE i.status <> 'draft'
       AND (i.advance_payment + i.bank_balance_due <> i.total_amount
            OR t.s <> i.total_amount)
     LIMIT 50) q;
  INSERT INTO data_health_results (run_id, check_code, severity, title, details)
  VALUES (v_run, 'HC-05', CASE WHEN v_n > 0 THEN 'critical' ELSE 'ok' END,
          'Purchase invoices: advance + bank due = total = lines', coalesce(v_bad, '[]'));

  ------------------------------------------------------------------ HC-06
  -- Drawer balances equal the journal cash accounts (view vs recompute)
  SELECT jsonb_agg(j), count(*) INTO v_bad, v_n FROM (
    SELECT jsonb_build_object('account', a.code, 'currency', b.currency,
             'view_balance', b.balance,
             'recomputed', fn_account_balance(a.id, b.currency)) AS j
      FROM accounts a
      JOIN v_account_balances b ON b.account_id = a.id
     WHERE a.type = 'cash'
       AND b.balance <> fn_account_balance(a.id, b.currency)
     LIMIT 50) q;
  INSERT INTO data_health_results (run_id, check_code, severity, title, details)
  VALUES (v_run, 'HC-06', CASE WHEN v_n > 0 THEN 'critical' ELSE 'ok' END,
          'Drawer balances equal journal cash accounts', coalesce(v_bad, '[]'));

  ------------------------------------------------------------------ HC-07
  -- Posted documents have journal entries; no orphan journal entries
  SELECT jsonb_agg(j), count(*) INTO v_bad, v_n FROM (
    SELECT jsonb_build_object('doc', d.doc_no, 'table', d.tbl,
                              'problem', 'posted without journal entry') AS j
      FROM (
        SELECT doc_no, id, 'purchase_invoices' AS tbl, 'purchase_invoice' AS st FROM purchase_invoices WHERE status <> 'draft'
        UNION ALL SELECT doc_no, id, 'supplier_payments', 'supplier_payment' FROM supplier_payments WHERE status <> 'draft'
        UNION ALL SELECT doc_no, id, 'dispatch_invoices', 'dispatch_invoice' FROM dispatch_invoices WHERE status <> 'draft'
        UNION ALL SELECT doc_no, id, 'warehouse_payments', 'warehouse_payment' FROM warehouse_payments WHERE status <> 'draft'
        UNION ALL SELECT doc_no, id, 'office_expenses', 'office_expense' FROM office_expenses WHERE status <> 'draft'
        UNION ALL SELECT coalesce(truck_ref, id::text), id, 'truck_receipts', 'truck_receipt' FROM truck_receipts WHERE status <> 'draft'
        UNION ALL SELECT id::text, id, 'order_expenses', 'order_expense' FROM order_expenses WHERE status <> 'draft'
        UNION ALL SELECT doc_no, id, 'roznamcha_manual', 'roznamcha_manual' FROM roznamcha_manual WHERE status <> 'draft'
        UNION ALL SELECT doc_no, id, 'saraf_transactions', 'saraf_transaction' FROM saraf_transactions
                   WHERE status <> 'draft' AND linked_source_type IS NULL
      ) d
     WHERE NOT EXISTS (SELECT 1 FROM journal_entries e
                        WHERE e.source_type = d.st AND e.source_id = d.id
                          AND e.status IN ('posted', 'reversed'))
    UNION ALL
    SELECT jsonb_build_object('entry_no', e.entry_no, 'fiscal_year', e.fiscal_year,
                              'source_type', e.source_type,
                              'problem', 'journal entry with no lines')
      FROM journal_entries e
     WHERE e.status IN ('posted', 'reversed')
       AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.entry_id = e.id)
     LIMIT 50) q;
  INSERT INTO data_health_results (run_id, check_code, severity, title, details)
  VALUES (v_run, 'HC-07', CASE WHEN v_n > 0 THEN 'critical' ELSE 'ok' END,
          'Posted documents ↔ journal entries linkage', coalesce(v_bad, '[]'));

  ------------------------------------------------------------------ HC-08
  -- Locked landed costs whose expense base changed after locking
  SELECT jsonb_agg(j), count(*) INTO v_bad, v_n FROM (
    SELECT jsonb_build_object('order', o.doc_no,
             'snapshot_expenses', (lc.calc_snapshot ->> 'expenses_converted_total')::numeric,
             'current_expenses', cur.s,
             'locked_at', lc.locked_at) AS j
      FROM landed_costs lc
      JOIN orders o ON o.id = lc.order_id
      JOIN LATERAL (
        SELECT coalesce(sum(fn_convert_currency(x.amount, x.currency, lc.currency, x.fx_rate)), 0) AS s
          FROM order_expenses x
         WHERE x.order_id = lc.order_id AND x.status = 'posted') cur ON true
     WHERE lc.locked_at IS NOT NULL
       AND (lc.calc_snapshot ->> 'expenses_converted_total')::numeric IS DISTINCT FROM cur.s
     LIMIT 50) q;
  INSERT INTO data_health_results (run_id, check_code, severity, title, details)
  VALUES (v_run, 'HC-08', CASE WHEN v_n > 0 THEN 'warning' ELSE 'ok' END,
          'Locked landed costs consistent with posted expenses', coalesce(v_bad, '[]'));

  ------------------------------------------------------------------ HC-09
  -- Retro-verify: central stock never dipped below zero at any point
  SELECT jsonb_agg(j), count(*) INTO v_bad, v_n FROM (
    SELECT jsonb_build_object('variant_id', variant_id, 'at', created_at,
                              'seq', seq, 'running_qty', run) AS j
      FROM (
        SELECT variant_id, created_at, seq,
               sum(qty) OVER (PARTITION BY variant_id ORDER BY seq) AS run
          FROM stock_movements
         WHERE warehouse_id IS NULL) r
     WHERE r.run < 0
     LIMIT 50) q;
  INSERT INTO data_health_results (run_id, check_code, severity, title, details)
  VALUES (v_run, 'HC-09', CASE WHEN v_n > 0 THEN 'critical' ELSE 'ok' END,
          'Dispatches never exceeded available stock (retro-verified)', coalesce(v_bad, '[]'));

  ------------------------------------------------------------------ HC-10
  -- Gapless posted document numbers per prefix/year
  SELECT jsonb_agg(j), count(*) INTO v_bad, v_n FROM (
    WITH all_docs AS (
      SELECT doc_no FROM purchase_invoices WHERE doc_no IS NOT NULL
      UNION ALL SELECT doc_no FROM supplier_payments WHERE doc_no IS NOT NULL
      UNION ALL SELECT doc_no FROM dispatch_invoices WHERE doc_no IS NOT NULL
      UNION ALL SELECT doc_no FROM warehouse_payments WHERE doc_no IS NOT NULL
      UNION ALL SELECT doc_no FROM office_expenses WHERE doc_no IS NOT NULL
      UNION ALL SELECT doc_no FROM orders WHERE doc_no IS NOT NULL
      UNION ALL SELECT doc_no FROM roznamcha_manual WHERE doc_no IS NOT NULL
      UNION ALL SELECT doc_no FROM saraf_transactions WHERE doc_no IS NOT NULL
    ),
    parsed AS (
      SELECT split_part(doc_no, '-', 1) AS prefix,
             split_part(doc_no, '-', 2)::int AS yr,
             split_part(doc_no, '-', 3)::int AS seq
        FROM all_docs
       WHERE doc_no ~ '^[A-Z]+-[0-9]{4}-[0-9]+$'
    )
    SELECT jsonb_build_object('prefix', prefix, 'year', yr,
             'expected_max', count(*), 'actual_max', max(seq),
             'problem', 'sequence gap or duplicate') AS j
      FROM parsed
     GROUP BY prefix, yr
    HAVING max(seq) <> count(*) OR count(DISTINCT seq) <> count(*)
     LIMIT 50) q;
  INSERT INTO data_health_results (run_id, check_code, severity, title, details)
  VALUES (v_run, 'HC-10', CASE WHEN v_n > 0 THEN 'warning' ELSE 'ok' END,
          'Document number sequences are gapless', coalesce(v_bad, '[]'));

  ------------------------------------------------------------------ HC-11
  -- Closed days: no cash lines on that date posted after the close
  SELECT jsonb_agg(j), count(*) INTO v_bad, v_n FROM (
    SELECT jsonb_build_object('day', d.day_date, 'entry_no', e.entry_no,
             'posted_at', e.posted_at, 'closed_at', d.closed_at) AS j
      FROM roznamcha_days d
      JOIN journal_entries e ON e.entry_date = d.day_date
                            AND e.status IN ('posted', 'reversed')
                            AND e.posted_at > d.closed_at
      JOIN journal_lines l ON l.entry_id = e.id
      JOIN accounts a ON a.id = l.account_id AND a.type = 'cash'
     WHERE d.status = 'closed'
     GROUP BY d.day_date, e.entry_no, e.posted_at, d.closed_at
     LIMIT 50) q;
  INSERT INTO data_health_results (run_id, check_code, severity, title, details)
  VALUES (v_run, 'HC-11', CASE WHEN v_n > 0 THEN 'critical' ELSE 'ok' END,
          'No cash postings into closed roznamcha days', coalesce(v_bad, '[]'));

  ------------------------------------------------------------------ HC-12
  -- Saraf ledgers: account linkage + balance recompute identity
  SELECT jsonb_agg(j), count(*) INTO v_bad, v_n FROM (
    SELECT jsonb_build_object('saraf_id', s.id, 'name', s.name,
                              'problem', 'missing ledger account') AS j
      FROM sarafs s WHERE s.account_id IS NULL
    UNION ALL
    SELECT jsonb_build_object('saraf_id', s.id, 'name', s.name,
                              'currency', b.currency, 'view_balance', b.balance,
                              'recomputed', fn_account_balance(s.account_id, b.currency),
                              'problem', 'balance drift')
      FROM sarafs s
      JOIN v_account_balances b ON b.account_id = s.account_id
     WHERE b.balance <> fn_account_balance(s.account_id, b.currency)
     LIMIT 50) q;
  INSERT INTO data_health_results (run_id, check_code, severity, title, details)
  VALUES (v_run, 'HC-12', CASE WHEN v_n > 0 THEN 'critical' ELSE 'ok' END,
          'Saraf ledgers equal their journal balances', coalesce(v_bad, '[]'));

  RETURN v_run;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_run_health_checks() TO authenticated;

-- Schedule nightly run when pg_cron is available (Supabase: enable extension)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('sarai-health-checks', '0 1 * * *', 'SELECT fn_run_health_checks()');
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Reconciliations
-- ---------------------------------------------------------------------------
CREATE TABLE reconciliations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rtype               text NOT NULL CHECK (rtype IN ('saraf', 'warehouse_stock', 'warehouse_money')),
  party_id            uuid NOT NULL,   -- saraf_id or warehouse_id
  period_start        date NULL,
  period_end          date NOT NULL,
  system_balance      jsonb NOT NULL DEFAULT '{}',
  external_balance    jsonb NOT NULL DEFAULT '{}',
  variance            jsonb NOT NULL DEFAULT '{}',
  adjustment_entry_id uuid NULL REFERENCES journal_entries (id),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  notes               text NULL,
  resolved_by         uuid NULL,
  resolved_at         timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL DEFAULT auth.uid(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL
);

-- Money reconciliation (saraf or warehouse): stated vs system per currency
CREATE OR REPLACE FUNCTION fn_reconcile_money(
  p_rtype      text,          -- 'saraf' | 'warehouse_money'
  p_party_id   uuid,
  p_period_end date,
  p_stated_afn numeric,
  p_stated_usd numeric,
  p_notes      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_acct uuid;
  v_afn  numeric;
  v_usd  numeric;
  v_id   uuid;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_rtype = 'saraf' THEN
    SELECT account_id INTO v_acct FROM sarafs WHERE id = p_party_id;
  ELSIF p_rtype = 'warehouse_money' THEN
    SELECT account_id INTO v_acct FROM warehouses WHERE id = p_party_id;
  ELSE
    RAISE EXCEPTION 'invalid money reconciliation type %', p_rtype;
  END IF;
  IF v_acct IS NULL THEN RAISE EXCEPTION 'party not found'; END IF;

  v_afn := fn_account_balance(v_acct, 'AFN', p_period_end);
  v_usd := fn_account_balance(v_acct, 'USD', p_period_end);

  INSERT INTO reconciliations
    (rtype, party_id, period_end, system_balance, external_balance, variance, notes)
  VALUES
    (p_rtype, p_party_id, p_period_end,
     jsonb_build_object('AFN', v_afn, 'USD', v_usd),
     jsonb_build_object('AFN', round(coalesce(p_stated_afn, 0), 4), 'USD', round(coalesce(p_stated_usd, 0), 4)),
     jsonb_build_object('AFN', round(coalesce(p_stated_afn, 0), 4) - v_afn,
                        'USD', round(coalesce(p_stated_usd, 0), 4) - v_usd),
     p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Resolve a money reconciliation; optionally post a documented adjustment
-- (party account vs 3000 Equity) for the variance.
CREATE OR REPLACE FUNCTION fn_resolve_money_reconciliation(
  p_recon_id        uuid,
  p_explanation     text,
  p_post_adjustment boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rec   reconciliations%ROWTYPE;
  v_acct  uuid;
  v_eq    uuid;
  v_lines jsonb := '[]';
  v_ccy   text;
  v_var   numeric;
  v_entry uuid := NULL;
BEGIN
  IF NOT app_is_admin() THEN
    RAISE EXCEPTION 'only an admin may resolve reconciliations';
  END IF;
  IF p_explanation IS NULL OR length(trim(p_explanation)) = 0 THEN
    RAISE EXCEPTION 'an explanation is required to resolve a reconciliation';
  END IF;

  SELECT * INTO v_rec FROM reconciliations WHERE id = p_recon_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation not found'; END IF;
  IF v_rec.status <> 'open' THEN RAISE EXCEPTION 'reconciliation already resolved'; END IF;
  IF v_rec.rtype NOT IN ('saraf', 'warehouse_money') THEN
    RAISE EXCEPTION 'use fn_resolve_stock_reconciliation for stock counts';
  END IF;

  IF p_post_adjustment THEN
    IF v_rec.rtype = 'saraf' THEN
      SELECT account_id INTO v_acct FROM sarafs WHERE id = v_rec.party_id;
    ELSE
      SELECT account_id INTO v_acct FROM warehouses WHERE id = v_rec.party_id;
    END IF;
    SELECT id INTO v_eq FROM accounts WHERE code = '3000';

    FOR v_ccy, v_var IN SELECT key, value::numeric FROM jsonb_each_text(v_rec.variance)
    LOOP
      IF v_var <> 0 THEN
        v_lines := v_lines
          || jsonb_build_object('account_id', v_acct, 'currency', v_ccy,
               'debit', greatest(v_var, 0), 'credit', greatest(-v_var, 0),
               'line_memo', 'Reconciliation adjustment')
          || jsonb_build_object('account_id', v_eq, 'currency', v_ccy,
               'debit', greatest(-v_var, 0), 'credit', greatest(v_var, 0),
               'line_memo', 'Reconciliation adjustment');
      END IF;
    END LOOP;

    IF jsonb_array_length(v_lines) > 0 THEN
      v_entry := fn_post_journal(
        CURRENT_DATE,
        'Reconciliation adjustment (' || v_rec.rtype || '): ' || p_explanation,
        'د حساب برابرولو سمون',  -- DRAFT-PS
        'reconciliation', p_recon_id, v_lines);
    END IF;
  END IF;

  UPDATE reconciliations
     SET status = 'resolved', notes = coalesce(notes || E'\n', '') || p_explanation,
         adjustment_entry_id = v_entry, resolved_by = auth.uid(), resolved_at = now()
   WHERE id = p_recon_id;
END;
$$;

-- Stock count reconciliation: counts arrive as [{variant_id, counted}]
CREATE OR REPLACE FUNCTION fn_reconcile_warehouse_stock(
  p_warehouse_id uuid,           -- NULL = central stock
  p_counts       jsonb,
  p_notes        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item     jsonb;
  v_system   jsonb := '{}';
  v_external jsonb := '{}';
  v_variance jsonb := '{}';
  v_sys      numeric;
  v_cnt      numeric;
  v_id       uuid;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_counts IS NULL OR jsonb_typeof(p_counts) <> 'array' OR jsonb_array_length(p_counts) = 0 THEN
    RAISE EXCEPTION 'counts are required as a non-empty array';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_counts)
  LOOP
    SELECT coalesce(sum(qty), 0) INTO v_sys
      FROM stock_movements
     WHERE variant_id = (v_item ->> 'variant_id')::uuid
       AND warehouse_id IS NOT DISTINCT FROM p_warehouse_id;
    v_cnt := round((v_item ->> 'counted')::numeric, 3);
    v_system   := v_system   || jsonb_build_object(v_item ->> 'variant_id', v_sys);
    v_external := v_external || jsonb_build_object(v_item ->> 'variant_id', v_cnt);
    v_variance := v_variance || jsonb_build_object(v_item ->> 'variant_id', v_cnt - v_sys);
  END LOOP;

  INSERT INTO reconciliations
    (rtype, party_id, period_end, system_balance, external_balance, variance, notes)
  VALUES
    ('warehouse_stock', coalesce(p_warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid),
     CURRENT_DATE, v_system, v_external, v_variance, p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Resolve a stock count: posts adjustment movements (and, for CENTRAL stock,
-- a journal entry valuing the variance at the pool's average cost).
CREATE OR REPLACE FUNCTION fn_resolve_stock_reconciliation(
  p_recon_id    uuid,
  p_explanation text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rec     reconciliations%ROWTYPE;
  v_wh      uuid;
  v_variant uuid;
  v_var     numeric;
  v_key     text;
  v_val     text;
  v_pool    record;
  v_amount  numeric;
  v_lines   jsonb;
  v_entry   uuid := NULL;
  v_invacct uuid;
  v_waste   uuid;
BEGIN
  IF NOT app_is_admin() THEN
    RAISE EXCEPTION 'only an admin may resolve reconciliations';
  END IF;
  IF p_explanation IS NULL OR length(trim(p_explanation)) = 0 THEN
    RAISE EXCEPTION 'an explanation is required to resolve a reconciliation';
  END IF;

  SELECT * INTO v_rec FROM reconciliations WHERE id = p_recon_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation not found'; END IF;
  IF v_rec.status <> 'open' THEN RAISE EXCEPTION 'reconciliation already resolved'; END IF;
  IF v_rec.rtype <> 'warehouse_stock' THEN
    RAISE EXCEPTION 'use fn_resolve_money_reconciliation for money reconciliations';
  END IF;

  v_wh := CASE WHEN v_rec.party_id = '00000000-0000-0000-0000-000000000000'::uuid
               THEN NULL ELSE v_rec.party_id END;

  FOR v_key, v_val IN SELECT key, value FROM jsonb_each_text(v_rec.variance)
  LOOP
    v_variant := v_key::uuid;
    v_var := v_val::numeric;
    IF v_var = 0 THEN CONTINUE; END IF;

    IF v_wh IS NULL THEN
      -- central: value the variance at the pool average cost
      SELECT * INTO v_pool FROM fn_central_cost_pool(v_variant) LIMIT 1;
      IF v_pool IS NULL THEN
        RAISE EXCEPTION 'no cost pool for variant % — cannot value the adjustment', v_variant;
      END IF;
      v_amount := round(v_pool.avg_cost * abs(v_var), 4);

      INSERT INTO stock_movements (movement_date, variant_id, warehouse_id, movement_type, qty,
                                   unit_cost, cost_currency, source_type, source_id, notes)
      VALUES (CURRENT_DATE, v_variant, NULL,
              CASE WHEN v_var < 0 THEN 'waste' ELSE 'adjustment' END::movement_type,
              v_var, v_pool.avg_cost, v_pool.currency, 'reconciliation', p_recon_id, p_explanation);

      SELECT id INTO v_invacct FROM accounts WHERE code = CASE
        (SELECT p.category FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.id = v_variant)
        WHEN 'oil' THEN '1200' ELSE '1210' END;
      SELECT id INTO v_waste FROM accounts WHERE code = '5200';

      IF v_var < 0 THEN
        v_lines := jsonb_build_array(
          jsonb_build_object('account_id', v_waste, 'currency', v_pool.currency,
                             'debit', v_amount, 'credit', 0, 'line_memo', p_explanation),
          jsonb_build_object('account_id', v_invacct, 'currency', v_pool.currency,
                             'debit', 0, 'credit', v_amount));
      ELSE
        v_lines := jsonb_build_array(
          jsonb_build_object('account_id', v_invacct, 'currency', v_pool.currency,
                             'debit', v_amount, 'credit', 0, 'line_memo', p_explanation),
          jsonb_build_object('account_id', v_waste, 'currency', v_pool.currency,
                             'debit', 0, 'credit', v_amount));
      END IF;

      v_entry := fn_post_journal(
        CURRENT_DATE,
        'Stock count adjustment (central): ' || p_explanation,
        'د ذخیرې د شمېرنې سمون',  -- DRAFT-PS
        'reconciliation', p_recon_id, v_lines);
    ELSE
      -- warehouse custody: quantity-only correction, no company journal
      INSERT INTO stock_movements (movement_date, variant_id, warehouse_id, movement_type, qty,
                                   source_type, source_id, notes)
      VALUES (CURRENT_DATE, v_variant, v_wh, 'adjustment', v_var,
              'reconciliation', p_recon_id, p_explanation);
    END IF;
  END LOOP;

  UPDATE reconciliations
     SET status = 'resolved', notes = coalesce(notes || E'\n', '') || p_explanation,
         adjustment_entry_id = v_entry, resolved_by = auth.uid(), resolved_at = now()
   WHERE id = p_recon_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_reconcile_money(text, uuid, date, numeric, numeric, text),
                          fn_resolve_money_reconciliation(uuid, text, boolean),
                          fn_reconcile_warehouse_stock(uuid, jsonb, text),
                          fn_resolve_stock_reconciliation(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE data_health_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliations     ENABLE ROW LEVEL SECURITY;

CREATE POLICY dhr_select ON data_health_results FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY recon_select ON reconciliations FOR SELECT TO authenticated USING (app_is_office());

GRANT SELECT ON data_health_results, reconciliations TO authenticated;

SELECT fn_enable_audit('reconciliations');
SELECT fn_enable_touch('reconciliations');
