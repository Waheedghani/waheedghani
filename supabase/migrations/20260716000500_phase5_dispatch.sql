-- ============================================================================
-- SARAI ERP — Phase 5: Warehouses & dispatch
-- Dispatch invoices (the warehouse is the DEBTOR: DR receivable / CR revenue
-- + DR COGS / CR inventory at moving-average landed cost), warehouse payments
-- (cash or via saraf, cross-currency through 3900 FX clearing), buyer
-- pickups, receivable aging, warehouse-portal RLS.
-- ============================================================================

CREATE TYPE wh_pay_method AS ENUM ('cash', 'saraf');

-- ---------------------------------------------------------------------------
-- Dispatch invoices
-- ---------------------------------------------------------------------------
CREATE TABLE dispatch_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no          text NULL UNIQUE,
  dispatch_date   date NOT NULL,
  warehouse_id    uuid NOT NULL REFERENCES warehouses (id),
  currency        currency_code NOT NULL DEFAULT 'AFN',
  fx_rate         numeric(12,6) NULL CHECK (fx_rate IS NULL OR fx_rate > 0),
  status          doc_status NOT NULL DEFAULT 'draft',
  notes           text NULL,
  -- keeper's arrival confirmation (informational; D-009)
  wh_confirmed_at timestamptz NULL,
  wh_confirmed_by uuid NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL DEFAULT auth.uid(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NULL,
  posted_by       uuid NULL,
  posted_at       timestamptz NULL,
  CONSTRAINT dsp_posted_doc_no CHECK (status = 'draft' OR doc_no IS NOT NULL)
);

CREATE INDEX idx_dsp_wh   ON dispatch_invoices (warehouse_id);
CREATE INDEX idx_dsp_date ON dispatch_invoices (dispatch_date);

CREATE TABLE dispatch_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id    uuid NOT NULL REFERENCES dispatch_invoices (id) ON DELETE CASCADE,
  variant_id     uuid NOT NULL REFERENCES product_variants (id),
  qty            numeric(14,3) NOT NULL CHECK (qty > 0),
  price_per_unit numeric(18,4) NOT NULL CHECK (price_per_unit >= 0),
  line_total     numeric(18,4) GENERATED ALWAYS AS (round(qty * price_per_unit, 4)) STORED,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NULL DEFAULT auth.uid(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid NULL
);

CREATE INDEX idx_dspl_dispatch ON dispatch_lines (dispatch_id);

SELECT fn_enable_doc_immutability('dispatch_invoices');
CREATE TRIGGER trg_dspl_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON dispatch_lines
  FOR EACH ROW EXECUTE FUNCTION fn_child_lines_frozen('dispatch_invoices', 'dispatch_id');

-- ---------------------------------------------------------------------------
-- Warehouse payments
-- settle_currency: which side of the receivable this settles. When it
-- differs from the tendered currency, fx_rate is mandatory and the entry
-- routes through 3900 FX Conversion Clearing (D-004).
-- ---------------------------------------------------------------------------
CREATE TABLE warehouse_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no          text NULL UNIQUE,
  payment_date    date NOT NULL,
  warehouse_id    uuid NOT NULL REFERENCES warehouses (id),
  currency        currency_code NOT NULL,
  amount          numeric(18,4) NOT NULL CHECK (amount > 0),
  settle_currency currency_code NULL,     -- NULL = same as currency
  fx_rate         numeric(12,6) NULL CHECK (fx_rate IS NULL OR fx_rate > 0),
  method          wh_pay_method NOT NULL,
  saraf_id        uuid NULL REFERENCES sarafs (id),
  hawala_number   text NULL,
  bill_refs       text[] NOT NULL DEFAULT '{}',
  status          doc_status NOT NULL DEFAULT 'draft',
  notes           text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL DEFAULT auth.uid(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NULL,
  posted_by       uuid NULL,
  posted_at       timestamptz NULL,
  CONSTRAINT wp_saraf_needs_saraf CHECK (method <> 'saraf' OR saraf_id IS NOT NULL),
  CONSTRAINT wp_cross_ccy_needs_rate CHECK (
    settle_currency IS NULL OR settle_currency = currency OR fx_rate IS NOT NULL),
  CONSTRAINT wp_posted_doc_no CHECK (status = 'draft' OR doc_no IS NOT NULL)
);

CREATE INDEX idx_wp_wh ON warehouse_payments (warehouse_id);

SELECT fn_enable_doc_immutability('warehouse_payments');

-- ---------------------------------------------------------------------------
-- Buyer pickups (warehouse custody ledger; recorded by the keeper)
-- ---------------------------------------------------------------------------
CREATE TABLE warehouse_pickups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES warehouses (id),
  pickup_date  date NOT NULL,
  variant_id   uuid NOT NULL REFERENCES product_variants (id),
  qty          numeric(14,3) NOT NULL CHECK (qty > 0),
  buyer_name   text NOT NULL,
  bill_ref     text NULL,
  notes        text NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NULL DEFAULT auth.uid()
);

CREATE INDEX idx_wpu_wh ON warehouse_pickups (warehouse_id);

CREATE OR REPLACE FUNCTION fn_wpu_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'pickup records are immutable; record a correcting entry instead';
END;
$$;

CREATE TRIGGER trg_wpu_immutable BEFORE UPDATE OR DELETE ON warehouse_pickups
  FOR EACH ROW EXECUTE FUNCTION fn_wpu_immutable();

-- ---------------------------------------------------------------------------
-- Moving-average cost pool for central stock (D-019)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_central_cost_pool(p_variant_id uuid)
RETURNS TABLE (currency currency_code, qty numeric, value numeric, avg_cost numeric)
LANGUAGE sql STABLE
AS $$
  SELECT cost_currency,
         sum(qty),
         round(sum(qty * unit_cost), 4),
         CASE WHEN sum(qty) <> 0 THEN round(sum(qty * unit_cost) / sum(qty), 6) ELSE 0 END
    FROM stock_movements
   WHERE variant_id = p_variant_id
     AND warehouse_id IS NULL
     AND cost_currency IS NOT NULL
   GROUP BY cost_currency
  HAVING sum(qty) <> 0 OR sum(qty * unit_cost) <> 0;
$$;

-- ---------------------------------------------------------------------------
-- POSTING: dispatch invoice
--   DR Warehouse Receivable / CR Sales Revenue     (selling price, chosen ccy)
--   DR COGS / CR Inventory                          (moving-average landed cost)
--   Stock: −central, +warehouse (custody)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_dispatch(p_dispatch_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_dsp     dispatch_invoices%ROWTYPE;
  v_wh      warehouses%ROWTYPE;
  v_line    record;
  v_pool    record;
  v_pools   int;
  v_avail   numeric;
  v_doc_no  text;
  v_entry   uuid;
  v_lines   jsonb := '[]';
  v_total   numeric := 0;
  v_rev_oil numeric := 0;
  v_rev_sug numeric := 0;
  v_cogs_oil numeric;
  v_cogs_sug numeric;
  v_cogs_ccy currency_code := NULL;
  v_category product_category;
  v_unit_cogs numeric;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized to post dispatch invoices';
  END IF;

  SELECT * INTO v_dsp FROM dispatch_invoices WHERE id = p_dispatch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dispatch invoice not found'; END IF;
  IF v_dsp.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft dispatches can be posted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM dispatch_lines WHERE dispatch_id = p_dispatch_id) THEN
    RAISE EXCEPTION 'dispatch has no lines';
  END IF;

  SELECT * INTO v_wh FROM warehouses WHERE id = v_dsp.warehouse_id;
  IF NOT v_wh.is_active THEN RAISE EXCEPTION 'warehouse is inactive'; END IF;

  v_doc_no := fn_next_doc_no('DSP', v_dsp.dispatch_date);
  v_cogs_oil := 0; v_cogs_sug := 0;

  FOR v_line IN
    SELECT dl.*, pv.product_id, p.category
      FROM dispatch_lines dl
      JOIN product_variants pv ON pv.id = dl.variant_id
      JOIN products p ON p.id = pv.product_id
     WHERE dl.dispatch_id = p_dispatch_id
  LOOP
    -- serialize stock checks per variant
    PERFORM pg_advisory_xact_lock(hashtext('central_stock'), hashtext(v_line.variant_id::text));

    SELECT coalesce(sum(qty), 0) INTO v_avail
      FROM stock_movements WHERE variant_id = v_line.variant_id AND warehouse_id IS NULL;
    IF v_avail < v_line.qty THEN
      RAISE EXCEPTION 'insufficient stock for %: available %, requested %',
        (SELECT label FROM product_variants WHERE id = v_line.variant_id), v_avail, v_line.qty;
    END IF;

    -- moving-average cost pool (single currency required per variant, D-019)
    SELECT count(*) INTO v_pools FROM fn_central_cost_pool(v_line.variant_id);
    IF v_pools = 0 THEN
      RAISE EXCEPTION 'no cost basis for variant %; receive stock before dispatching',
        (SELECT label FROM product_variants WHERE id = v_line.variant_id);
    ELSIF v_pools > 1 THEN
      RAISE EXCEPTION 'variant % has stock valued in multiple currencies; reconcile before dispatching',
        (SELECT label FROM product_variants WHERE id = v_line.variant_id);
    END IF;
    SELECT * INTO v_pool FROM fn_central_cost_pool(v_line.variant_id);
    IF v_cogs_ccy IS NULL THEN
      v_cogs_ccy := v_pool.currency;
    ELSIF v_cogs_ccy <> v_pool.currency THEN
      RAISE EXCEPTION 'dispatch mixes cost pools in different currencies (% and %)', v_cogs_ccy, v_pool.currency;
    END IF;

    v_unit_cogs := v_pool.avg_cost;
    IF v_line.category = 'oil' THEN
      v_cogs_oil := v_cogs_oil + round(v_unit_cogs * v_line.qty, 4);
    ELSE
      v_cogs_sug := v_cogs_sug + round(v_unit_cogs * v_line.qty, 4);
    END IF;

    v_total := v_total + v_line.line_total;
    IF v_line.category = 'oil' THEN
      v_rev_oil := v_rev_oil + v_line.line_total;
    ELSE
      v_rev_sug := v_rev_sug + v_line.line_total;
    END IF;

    -- stock: out of central (at avg cost), into warehouse custody
    INSERT INTO stock_movements (movement_date, variant_id, warehouse_id, movement_type, qty,
                                 unit_cost, cost_currency, source_type, source_id, notes)
    VALUES (v_dsp.dispatch_date, v_line.variant_id, NULL, 'dispatch', -v_line.qty,
            v_unit_cogs, v_pool.currency, 'dispatch_invoice', p_dispatch_id, v_doc_no),
           (v_dsp.dispatch_date, v_line.variant_id, v_dsp.warehouse_id, 'dispatch', v_line.qty,
            NULL, NULL, 'dispatch_invoice', p_dispatch_id, v_doc_no);
  END LOOP;

  -- revenue legs (dispatch currency)
  v_lines := v_lines || jsonb_build_object(
    'account_id', v_wh.account_id, 'currency', v_dsp.currency,
    'debit', v_total, 'credit', 0, 'fx_rate', v_dsp.fx_rate,
    'line_memo', 'Warehouse receivable ' || v_doc_no);
  IF v_rev_oil > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_id', (SELECT id FROM accounts WHERE code = '4000'), 'currency', v_dsp.currency,
      'debit', 0, 'credit', v_rev_oil, 'fx_rate', v_dsp.fx_rate, 'line_memo', 'Oil sales');
  END IF;
  IF v_rev_sug > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_id', (SELECT id FROM accounts WHERE code = '4010'), 'currency', v_dsp.currency,
      'debit', 0, 'credit', v_rev_sug, 'fx_rate', v_dsp.fx_rate, 'line_memo', 'Sugar sales');
  END IF;

  -- COGS legs (cost-pool currency)
  IF v_cogs_oil > 0 THEN
    v_lines := v_lines
      || jsonb_build_object('account_id', (SELECT id FROM accounts WHERE code = '5000'),
           'currency', v_cogs_ccy, 'debit', v_cogs_oil, 'credit', 0, 'line_memo', 'COGS oil')
      || jsonb_build_object('account_id', (SELECT id FROM accounts WHERE code = '1200'),
           'currency', v_cogs_ccy, 'debit', 0, 'credit', v_cogs_oil, 'line_memo', 'Inventory out');
  END IF;
  IF v_cogs_sug > 0 THEN
    v_lines := v_lines
      || jsonb_build_object('account_id', (SELECT id FROM accounts WHERE code = '5010'),
           'currency', v_cogs_ccy, 'debit', v_cogs_sug, 'credit', 0, 'line_memo', 'COGS sugar')
      || jsonb_build_object('account_id', (SELECT id FROM accounts WHERE code = '1210'),
           'currency', v_cogs_ccy, 'debit', 0, 'credit', v_cogs_sug, 'line_memo', 'Inventory out');
  END IF;

  v_entry := fn_post_journal(
    v_dsp.dispatch_date,
    'Dispatch ' || v_doc_no || ' — ' || v_wh.name,
    'لېږد ' || v_doc_no || ' — ' || coalesce(v_wh.name_ps, ''),  -- DRAFT-PS
    'dispatch_invoice', p_dispatch_id, v_lines);

  PERFORM set_config('app.posting', 'on', true);
  UPDATE dispatch_invoices
     SET status = 'posted', doc_no = v_doc_no, posted_by = auth.uid(), posted_at = now()
   WHERE id = p_dispatch_id;
  PERFORM set_config('app.posting', '', true);

  RETURN v_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_post_dispatch(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Keeper confirms goods arrived (informational)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_confirm_dispatch(p_dispatch_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_dsp dispatch_invoices%ROWTYPE;
BEGIN
  SELECT * INTO v_dsp FROM dispatch_invoices WHERE id = p_dispatch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dispatch not found'; END IF;
  IF v_dsp.status <> 'posted' THEN
    RAISE EXCEPTION 'only posted dispatches can be confirmed';
  END IF;
  IF NOT (app_is_office() OR v_dsp.warehouse_id = app_current_warehouse()) THEN
    RAISE EXCEPTION 'not authorized for this warehouse';
  END IF;
  IF v_dsp.wh_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'dispatch already confirmed';
  END IF;

  PERFORM set_config('app.posting', 'on', true);
  UPDATE dispatch_invoices
     SET wh_confirmed_at = now(), wh_confirmed_by = auth.uid()
   WHERE id = p_dispatch_id;
  PERFORM set_config('app.posting', '', true);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_confirm_dispatch(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Buyer pickup (keeper of that warehouse, or office)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_record_pickup(
  p_warehouse_id uuid,
  p_variant_id   uuid,
  p_qty          numeric,
  p_buyer_name   text,
  p_bill_ref     text DEFAULT NULL,
  p_pickup_date  date DEFAULT CURRENT_DATE,
  p_notes        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_avail numeric;
  v_id    uuid;
BEGIN
  IF NOT (app_is_office() OR p_warehouse_id = app_current_warehouse()) THEN
    RAISE EXCEPTION 'not authorized for this warehouse';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'pickup quantity must be positive';
  END IF;
  IF p_buyer_name IS NULL OR length(trim(p_buyer_name)) = 0 THEN
    RAISE EXCEPTION 'buyer name is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wh_stock'), hashtext(p_warehouse_id::text || p_variant_id::text));
  SELECT coalesce(sum(qty), 0) INTO v_avail
    FROM stock_movements WHERE variant_id = p_variant_id AND warehouse_id = p_warehouse_id;
  IF v_avail < p_qty THEN
    RAISE EXCEPTION 'insufficient stock at warehouse: available %, requested %', v_avail, p_qty;
  END IF;

  INSERT INTO warehouse_pickups (warehouse_id, pickup_date, variant_id, qty, buyer_name, bill_ref, notes)
  VALUES (p_warehouse_id, p_pickup_date, p_variant_id, p_qty, trim(p_buyer_name), p_bill_ref, p_notes)
  RETURNING id INTO v_id;

  INSERT INTO stock_movements (movement_date, variant_id, warehouse_id, movement_type, qty, source_type, source_id, notes)
  VALUES (p_pickup_date, p_variant_id, p_warehouse_id, 'pickup', -p_qty,
          'warehouse_pickup', v_id, 'Buyer: ' || trim(p_buyer_name) || coalesce(' bill ' || p_bill_ref, ''));

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_record_pickup(uuid, uuid, numeric, text, text, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- POSTING: warehouse payment (cash or via saraf; cross-currency via 3900)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_warehouse_payment(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pay     warehouse_payments%ROWTYPE;
  v_wh      warehouses%ROWTYPE;
  v_debit   uuid;   -- cash drawer or saraf account
  v_settle  currency_code;
  v_settled numeric;
  v_fx      uuid;
  v_doc_no  text;
  v_entry   uuid;
  v_lines   jsonb;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized to post warehouse payments';
  END IF;

  SELECT * INTO v_pay FROM warehouse_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse payment not found'; END IF;
  IF v_pay.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft payments can be posted';
  END IF;

  SELECT * INTO v_wh FROM warehouses WHERE id = v_pay.warehouse_id;
  v_settle := coalesce(v_pay.settle_currency, v_pay.currency);

  IF v_pay.method = 'cash' THEN
    SELECT id INTO v_debit FROM accounts
     WHERE code = CASE v_pay.currency WHEN 'AFN' THEN '1000' ELSE '1001' END;
  ELSE
    SELECT account_id INTO v_debit FROM sarafs WHERE id = v_pay.saraf_id;
    IF v_debit IS NULL THEN RAISE EXCEPTION 'saraf has no ledger account'; END IF;
  END IF;

  v_doc_no := fn_next_doc_no('WP', v_pay.payment_date);

  IF v_settle = v_pay.currency THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_debit, 'currency', v_pay.currency,
                         'debit', v_pay.amount, 'credit', 0,
                         'line_memo', CASE v_pay.method WHEN 'saraf'
                           THEN 'Via saraf, hawala ' || coalesce(v_pay.hawala_number, '-')
                           ELSE 'Cash received' END),
      jsonb_build_object('account_id', v_wh.account_id, 'currency', v_pay.currency,
                         'debit', 0, 'credit', v_pay.amount,
                         'line_memo', 'Settles: ' || array_to_string(v_pay.bill_refs, ', ')));
  ELSE
    -- cross-currency settlement through FX clearing (D-004), manual rate
    v_settled := fn_convert_currency(v_pay.amount, v_pay.currency, v_settle, v_pay.fx_rate);
    SELECT id INTO v_fx FROM accounts WHERE code = '3900';
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_debit, 'currency', v_pay.currency,
                         'debit', v_pay.amount, 'credit', 0, 'fx_rate', v_pay.fx_rate,
                         'line_memo', 'Received ' || v_pay.currency),
      jsonb_build_object('account_id', v_fx, 'currency', v_pay.currency,
                         'debit', 0, 'credit', v_pay.amount, 'fx_rate', v_pay.fx_rate,
                         'fx_note', 'rate ' || v_pay.fx_rate || ' AFN/USD'),
      jsonb_build_object('account_id', v_fx, 'currency', v_settle,
                         'debit', v_settled, 'credit', 0, 'fx_rate', v_pay.fx_rate,
                         'fx_note', 'rate ' || v_pay.fx_rate || ' AFN/USD'),
      jsonb_build_object('account_id', v_wh.account_id, 'currency', v_settle,
                         'debit', 0, 'credit', v_settled, 'fx_rate', v_pay.fx_rate,
                         'line_memo', 'Settles: ' || array_to_string(v_pay.bill_refs, ', ')));
  END IF;

  v_entry := fn_post_journal(
    v_pay.payment_date,
    'Warehouse payment ' || v_doc_no || ' — ' || v_wh.name ||
      CASE v_pay.method WHEN 'saraf' THEN ' (via saraf)' ELSE '' END,
    'د سرای تادیه ' || v_doc_no || ' — ' || coalesce(v_wh.name_ps, ''),  -- DRAFT-PS
    'warehouse_payment', p_payment_id, v_lines);

  PERFORM set_config('app.posting', 'on', true);
  UPDATE warehouse_payments
     SET status = 'posted', doc_no = v_doc_no, posted_by = auth.uid(), posted_at = now()
   WHERE id = p_payment_id;
  PERFORM set_config('app.posting', '', true);

  RETURN v_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_post_warehouse_payment(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Saraf releases cash to the drawer: DR Cash Drawer / CR Saraf account
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_saraf_cash_release(
  p_saraf_id uuid, p_currency currency_code, p_amount numeric,
  p_date date DEFAULT CURRENT_DATE, p_hawala_number text DEFAULT NULL,
  p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_saraf  sarafs%ROWTYPE;
  v_drawer uuid;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;
  SELECT * INTO v_saraf FROM sarafs WHERE id = p_saraf_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'saraf not found'; END IF;
  SELECT id INTO v_drawer FROM accounts
   WHERE code = CASE p_currency WHEN 'AFN' THEN '1000' ELSE '1001' END;

  RETURN fn_post_journal(
    p_date,
    'Cash from saraf ' || v_saraf.name || coalesce(' hawala ' || p_hawala_number, '') ||
      coalesce(' — ' || p_note, ''),
    'له صراف نغدې — ' || coalesce(v_saraf.name_ps, ''),  -- DRAFT-PS
    'saraf_cash_release', p_saraf_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_drawer, 'currency', p_currency,
                         'debit', round(p_amount, 4), 'credit', 0),
      jsonb_build_object('account_id', v_saraf.account_id, 'currency', p_currency,
                         'debit', 0, 'credit', round(p_amount, 4),
                         'line_memo', coalesce('hawala ' || p_hawala_number, ''))));
END;
$$;

GRANT EXECUTE ON FUNCTION fn_post_saraf_cash_release(uuid, currency_code, numeric, date, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Receivables aging (0–7 / 8–30 / 31+): outstanding balance allocated to the
-- most recent receivable debits (payments settle oldest first).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_receivables_aging(p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  warehouse_id uuid, warehouse_name text, warehouse_name_ps text,
  currency currency_code,
  bucket_0_7 numeric, bucket_8_30 numeric, bucket_31_plus numeric, total numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH bal AS (
    SELECT w.id AS wh_id, w.name, w.name_ps, w.account_id, l.currency AS ccy,
           sum(l.debit - l.credit) AS balance
      FROM warehouses w
      JOIN journal_lines l ON l.account_id = w.account_id
      JOIN journal_entries e ON e.id = l.entry_id AND e.status IN ('posted', 'reversed')
     WHERE e.entry_date <= p_as_of
       AND app_is_office()  -- office/admin only
     GROUP BY w.id, w.name, w.name_ps, w.account_id, l.currency
    HAVING sum(l.debit - l.credit) > 0
  ),
  debits AS (
    SELECT b.wh_id, b.ccy, e.entry_date, l.debit,
           sum(l.debit) OVER (PARTITION BY b.wh_id, b.ccy
                              ORDER BY e.entry_date DESC, e.entry_no DESC, l.line_no
                              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS newer
      FROM bal b
      JOIN journal_lines l ON l.account_id = b.account_id AND l.currency = b.ccy AND l.debit > 0
      JOIN journal_entries e ON e.id = l.entry_id AND e.status IN ('posted', 'reversed')
     WHERE e.entry_date <= p_as_of
  ),
  alloc AS (
    SELECT d.wh_id, d.ccy, d.entry_date,
           greatest(0, least(d.debit, b.balance - coalesce(d.newer, 0))) AS open_amt
      FROM debits d
      JOIN bal b ON b.wh_id = d.wh_id AND b.ccy = d.ccy
  )
  SELECT b.wh_id, b.name, b.name_ps, b.ccy,
         coalesce(sum(a.open_amt) FILTER (WHERE p_as_of - a.entry_date <= 7), 0),
         coalesce(sum(a.open_amt) FILTER (WHERE p_as_of - a.entry_date BETWEEN 8 AND 30), 0),
         coalesce(sum(a.open_amt) FILTER (WHERE p_as_of - a.entry_date > 30), 0),
         b.balance
    FROM bal b
    LEFT JOIN alloc a ON a.wh_id = b.wh_id AND a.ccy = b.ccy AND a.open_amt > 0
   GROUP BY b.wh_id, b.name, b.name_ps, b.ccy, b.balance;
$$;

GRANT EXECUTE ON FUNCTION fn_receivables_aging(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS: office everything; warehouse keepers their own سرای only
-- ---------------------------------------------------------------------------
ALTER TABLE dispatch_invoices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_pickups  ENABLE ROW LEVEL SECURITY;

CREATE POLICY dsp_select ON dispatch_invoices FOR SELECT TO authenticated
  USING (app_is_office() OR warehouse_id = app_current_warehouse());
CREATE POLICY dsp_insert ON dispatch_invoices FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY dsp_update ON dispatch_invoices FOR UPDATE TO authenticated
  USING (app_is_office() AND status = 'draft') WITH CHECK (app_is_office() AND status = 'draft');
CREATE POLICY dsp_delete ON dispatch_invoices FOR DELETE TO authenticated
  USING (status = 'draft' AND (created_by = auth.uid() OR app_is_admin()));

CREATE POLICY dspl_select ON dispatch_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM dispatch_invoices d WHERE d.id = dispatch_id
                   AND (app_is_office() OR d.warehouse_id = app_current_warehouse())));
CREATE POLICY dspl_insert ON dispatch_lines FOR INSERT TO authenticated
  WITH CHECK (app_is_office() AND EXISTS
    (SELECT 1 FROM dispatch_invoices d WHERE d.id = dispatch_id AND d.status = 'draft'));
CREATE POLICY dspl_update ON dispatch_lines FOR UPDATE TO authenticated
  USING (app_is_office() AND EXISTS
    (SELECT 1 FROM dispatch_invoices d WHERE d.id = dispatch_id AND d.status = 'draft'));
CREATE POLICY dspl_delete ON dispatch_lines FOR DELETE TO authenticated
  USING (app_is_office() AND EXISTS
    (SELECT 1 FROM dispatch_invoices d WHERE d.id = dispatch_id AND d.status = 'draft'));

CREATE POLICY wp_select ON warehouse_payments FOR SELECT TO authenticated
  USING (app_is_office() OR warehouse_id = app_current_warehouse());
CREATE POLICY wp_insert ON warehouse_payments FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY wp_update ON warehouse_payments FOR UPDATE TO authenticated
  USING (app_is_office() AND status = 'draft') WITH CHECK (app_is_office() AND status = 'draft');
CREATE POLICY wp_delete ON warehouse_payments FOR DELETE TO authenticated
  USING (status = 'draft' AND (created_by = auth.uid() OR app_is_admin()));

CREATE POLICY wpu_select ON warehouse_pickups FOR SELECT TO authenticated
  USING (app_is_office() OR warehouse_id = app_current_warehouse());
-- pickups are written only via fn_record_pickup

GRANT SELECT, INSERT, UPDATE, DELETE ON dispatch_invoices, dispatch_lines, warehouse_payments TO authenticated;
GRANT SELECT ON warehouse_pickups TO authenticated;

SELECT fn_enable_audit(t)
  FROM unnest(ARRAY['dispatch_invoices', 'dispatch_lines', 'warehouse_payments', 'warehouse_pickups']::regclass[]) AS t;
SELECT fn_enable_touch(t)
  FROM unnest(ARRAY['dispatch_invoices', 'dispatch_lines', 'warehouse_payments']::regclass[]) AS t;
