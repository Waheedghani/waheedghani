-- ============================================================================
-- SARAI ERP — Phase 4: Order book, truck receipts, waste, route expenses,
-- landed cost, stock into inventory.
--
-- COST MODEL (D-015):
--   c = invoice unit price of the ordered variant
--   E = posted route expenses converted to the order currency at each
--       transaction's manual rate
--   denom = expected units − waste posted so far
--   landed L = (c*denom + E) / denom       (auto; final editable, admin-only)
--
--   Truck receipt posting (order currency), r = received, w = waste:
--     DR Inventory            round(L*r, 4)
--     DR Waste 5200           round(c*w, 4)
--     CR Goods in Transit     round(c*(r+w), 4)      -- drains at invoice cost
--     CR 5190 Capitalized     the exact remainder ≈ r*(L−c)  -- expense share
--   Over a fully received order: transit nets to 0, 5190 offsets the 5100s
--   (route expenses are capitalized into inventory), and waste sits in 5200 —
--   "absorbed by the company", inflating L because E spreads over fewer units.
--
-- FX-RATE SEMANTICS (D-016): fx_rate is always AFN per 1 USD (the bazaar
-- quote). AFN→USD = amount / rate; USD→AFN = amount * rate.
-- ============================================================================

CREATE TYPE order_status AS ENUM ('open', 'partially_received', 'received', 'closed');
CREATE TYPE order_expense_category AS ENUM ('shipping', 'surcharge', 'customs', 'transport', 'other');
CREATE TYPE expense_paid_via AS ENUM ('cash', 'bank', 'payable');
CREATE TYPE movement_type AS ENUM ('receive', 'waste', 'dispatch', 'adjustment', 'return', 'pickup');

-- ---------------------------------------------------------------------------
-- Orders (numbered at creation; no draft stage; never deleted)
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no              text NOT NULL UNIQUE,
  order_date          date NOT NULL,
  purchase_invoice_id uuid NOT NULL REFERENCES purchase_invoices (id),
  supplier_id         uuid NOT NULL REFERENCES suppliers (id),
  variant_id          uuid NOT NULL REFERENCES product_variants (id),
  trucks_total        int NOT NULL CHECK (trucks_total > 0),
  containers_total    int NOT NULL CHECK (containers_total > 0),
  units_per_container numeric(14,3) NOT NULL CHECK (units_per_container > 0),
  bill_number         text NULL,
  container_numbers   text[] NOT NULL DEFAULT '{}',
  status              order_status NOT NULL DEFAULT 'open',
  notes               text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL DEFAULT auth.uid(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL
);

CREATE INDEX idx_orders_invoice ON orders (purchase_invoice_id);

CREATE OR REPLACE FUNCTION fn_orders_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv purchase_invoices%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM purchase_invoices WHERE id = NEW.purchase_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order must reference a purchase invoice';
  END IF;
  IF v_inv.status = 'draft' THEN
    RAISE EXCEPTION 'purchase invoice must be posted before creating its order';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM purchase_invoice_lines
                  WHERE invoice_id = NEW.purchase_invoice_id AND variant_id = NEW.variant_id) THEN
    RAISE EXCEPTION 'the purchase invoice has no line for this product variant';
  END IF;
  NEW.supplier_id := v_inv.supplier_id;
  NEW.doc_no := fn_next_doc_no('ORD', NEW.order_date);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_bi BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_orders_before_insert();

-- Orders: no deletes ever; quantity-defining fields frozen once receiving
-- starts; closed orders frozen entirely (except via posting functions).
CREATE OR REPLACE FUNCTION fn_orders_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders are numbered documents and can never be deleted';
  END IF;
  IF current_setting('app.posting', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'order % is closed and immutable', OLD.doc_no;
  END IF;
  IF (NEW.containers_total, NEW.units_per_container, NEW.variant_id,
      NEW.purchase_invoice_id, NEW.doc_no)
     IS DISTINCT FROM
     (OLD.containers_total, OLD.units_per_container, OLD.variant_id,
      OLD.purchase_invoice_id, OLD.doc_no)
     AND EXISTS (SELECT 1 FROM truck_receipts r
                  WHERE r.order_id = OLD.id AND r.status = 'posted') THEN
    RAISE EXCEPTION 'order quantities cannot change after receiving has started';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'order status changes only through receiving/closing functions';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Truck receipts
-- ---------------------------------------------------------------------------
CREATE TABLE truck_receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders (id),
  receipt_date date NOT NULL,
  truck_ref    text NULL,
  containers   int NOT NULL DEFAULT 0 CHECK (containers >= 0),
  qty_expected numeric(14,3) NOT NULL CHECK (qty_expected > 0),
  qty_received numeric(14,3) NOT NULL CHECK (qty_received >= 0),
  qty_waste    numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_waste >= 0),
  notes        text NULL,
  status       doc_status NOT NULL DEFAULT 'draft',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NULL DEFAULT auth.uid(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid NULL,
  posted_by    uuid NULL,
  posted_at    timestamptz NULL,
  CONSTRAINT tr_qty_math CHECK (qty_received + qty_waste = qty_expected)
);

CREATE INDEX idx_tr_order ON truck_receipts (order_id);

-- ---------------------------------------------------------------------------
-- Route expenses per order
-- ---------------------------------------------------------------------------
CREATE TABLE order_expenses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES orders (id),
  expense_date   date NOT NULL,
  category       order_expense_category NOT NULL,
  description    text NOT NULL,
  description_ps text NOT NULL DEFAULT '',
  currency       currency_code NOT NULL,
  amount         numeric(18,4) NOT NULL CHECK (amount > 0),
  fx_rate        numeric(12,6) NULL CHECK (fx_rate IS NULL OR fx_rate > 0),
  paid_via       expense_paid_via NOT NULL,
  bank_name      text NULL,
  status         doc_status NOT NULL DEFAULT 'draft',
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NULL DEFAULT auth.uid(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid NULL,
  posted_by      uuid NULL,
  posted_at      timestamptz NULL,
  CONSTRAINT oe_bank_needs_name CHECK (paid_via <> 'bank' OR bank_name IS NOT NULL)
);

CREATE INDEX idx_oe_order ON order_expenses (order_id);

-- ---------------------------------------------------------------------------
-- Landed cost per order
-- ---------------------------------------------------------------------------
CREATE TABLE landed_costs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL UNIQUE REFERENCES orders (id),
  auto_cost_per_unit numeric(18,6) NOT NULL DEFAULT 0,
  final_cost_per_unit numeric(18,6) NOT NULL DEFAULT 0,
  currency           currency_code NOT NULL,
  calc_snapshot      jsonb NOT NULL DEFAULT '{}',
  locked_at          timestamptz NULL,
  locked_by          uuid NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NULL DEFAULT auth.uid(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NULL
);

-- landed_costs mutate only through functions
CREATE OR REPLACE FUNCTION fn_landed_costs_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'landed cost records cannot be deleted';
  END IF;
  IF current_setting('app.posting', true) = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'landed cost changes only through fn_recompute_landed_cost / fn_set_final_landed_cost / fn_lock_landed_cost';
END;
$$;

CREATE TRIGGER trg_landed_costs_guard BEFORE UPDATE OR DELETE ON landed_costs
  FOR EACH ROW EXECUTE FUNCTION fn_landed_costs_guard();

-- ---------------------------------------------------------------------------
-- Stock movements (signed; warehouse_id NULL = central/company stock)
-- Written ONLY by posting functions.
-- ---------------------------------------------------------------------------
CREATE TABLE stock_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- monotonic insertion order: created_at is transaction-fixed, so ties are
  -- possible; seq gives HC-09 (retro stock verification) a total order
  seq           bigint GENERATED ALWAYS AS IDENTITY,
  movement_date date NOT NULL,
  variant_id    uuid NOT NULL REFERENCES product_variants (id),
  warehouse_id  uuid NULL REFERENCES warehouses (id),
  movement_type movement_type NOT NULL,
  qty           numeric(14,3) NOT NULL CHECK (qty <> 0),
  -- cost tracking for COMPANY (central) stock only: landed unit cost at
  -- receive; moving-average cost at dispatch. Warehouse-custody rows carry
  -- no cost (the company has already sold the goods to the warehouse).
  unit_cost     numeric(18,6) NULL,
  cost_currency currency_code NULL,
  source_type   text NULL,
  source_id     uuid NULL,
  notes         text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NULL DEFAULT auth.uid()
);

CREATE INDEX idx_sm_variant_wh ON stock_movements (variant_id, warehouse_id);
CREATE INDEX idx_sm_source ON stock_movements (source_type, source_id);

-- stock movements are immutable facts (corrections = opposite movements)
CREATE OR REPLACE FUNCTION fn_sm_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'stock movements are immutable; post an adjustment instead';
END;
$$;

CREATE TRIGGER trg_sm_immutable BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_sm_immutable();

-- Live stock levels (plain view — cannot drift; D-017)
CREATE OR REPLACE VIEW v_stock_levels WITH (security_invoker = true) AS
SELECT variant_id, warehouse_id, sum(qty) AS qty
  FROM stock_movements
 GROUP BY variant_id, warehouse_id;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_order_unit_cost(p_order_id uuid)
RETURNS numeric
LANGUAGE sql STABLE
AS $$
  SELECT l.price_per_unit
    FROM orders o
    JOIN purchase_invoice_lines l
      ON l.invoice_id = o.purchase_invoice_id AND l.variant_id = o.variant_id
   WHERE o.id = p_order_id
   LIMIT 1;
$$;

-- convert an amount to the order currency using the manual rate (D-016)
CREATE OR REPLACE FUNCTION fn_convert_currency(
  p_amount numeric, p_from currency_code, p_to currency_code, p_rate numeric)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF p_from = p_to THEN
    RETURN p_amount;
  END IF;
  IF p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'a manual exchange rate is required to convert % to %', p_from, p_to;
  END IF;
  IF p_from = 'AFN' AND p_to = 'USD' THEN
    RETURN round(p_amount / p_rate, 4);
  END IF;
  RETURN round(p_amount * p_rate, 4); -- USD -> AFN
END;
$$;

-- ---------------------------------------------------------------------------
-- Landed cost: recompute / edit / lock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_recompute_landed_cost(p_order_id uuid)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order    orders%ROWTYPE;
  v_lc       landed_costs%ROWTYPE;
  v_ccy      currency_code;
  v_c        numeric;        -- invoice unit cost
  v_expected numeric;
  v_waste    numeric;
  v_denom    numeric;
  v_exp_sum  numeric := 0;
  v_auto     numeric;
  v_exp      record;
  v_exp_list jsonb := '[]';
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;

  SELECT * INTO v_lc FROM landed_costs WHERE order_id = p_order_id;
  IF v_lc.locked_at IS NOT NULL THEN
    RETURN v_lc.final_cost_per_unit; -- locked: leave untouched (HC-08 flags drift)
  END IF;

  SELECT currency INTO v_ccy FROM purchase_invoices WHERE id = v_order.purchase_invoice_id;
  v_c := fn_order_unit_cost(p_order_id);

  v_expected := v_order.containers_total * v_order.units_per_container;
  SELECT coalesce(sum(qty_waste), 0) INTO v_waste
    FROM truck_receipts WHERE order_id = p_order_id AND status = 'posted';
  v_denom := v_expected - v_waste;
  IF v_denom <= 0 THEN
    RAISE EXCEPTION 'order has no receivable quantity (expected % minus waste %)', v_expected, v_waste;
  END IF;

  FOR v_exp IN
    SELECT * FROM order_expenses
     WHERE order_id = p_order_id AND status = 'posted'
     ORDER BY expense_date, created_at
  LOOP
    v_exp_sum := v_exp_sum + fn_convert_currency(v_exp.amount, v_exp.currency, v_ccy, v_exp.fx_rate);
    v_exp_list := v_exp_list || jsonb_build_object(
      'id', v_exp.id, 'category', v_exp.category, 'description', v_exp.description,
      'currency', v_exp.currency, 'amount', v_exp.amount, 'fx_rate', v_exp.fx_rate,
      'converted', fn_convert_currency(v_exp.amount, v_exp.currency, v_ccy, v_exp.fx_rate));
  END LOOP;

  v_auto := round((v_c * v_denom + v_exp_sum) / v_denom, 6);

  PERFORM set_config('app.posting', 'on', true);
  UPDATE landed_costs
     SET auto_cost_per_unit  = v_auto,
         -- final follows auto unless an admin has manually overridden it
         final_cost_per_unit = CASE WHEN calc_snapshot ? 'manual_override'
                                    THEN final_cost_per_unit ELSE v_auto END,
         currency = v_ccy,
         calc_snapshot = jsonb_build_object(
           'invoice_unit_cost', v_c,
           'expected_units', v_expected,
           'waste_units', v_waste,
           'denominator', v_denom,
           'expenses_converted_total', v_exp_sum,
           'expenses', v_exp_list,
           'formula', '(c*denom + E)/denom',
           'computed_at', now())
   WHERE order_id = p_order_id;
  PERFORM set_config('app.posting', '', true);

  RETURN v_auto;
END;
$$;

-- Admin may override the auto cost (spec §8: landed-cost editing is admin)
CREATE OR REPLACE FUNCTION fn_set_final_landed_cost(p_order_id uuid, p_cost numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lc landed_costs%ROWTYPE;
BEGIN
  IF NOT app_is_admin() THEN
    RAISE EXCEPTION 'only an admin may edit the landed cost';
  END IF;
  SELECT * INTO v_lc FROM landed_costs WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'landed cost record not found'; END IF;
  IF v_lc.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'landed cost is locked';
  END IF;
  IF p_cost IS NULL OR p_cost <= 0 THEN
    RAISE EXCEPTION 'landed cost must be positive';
  END IF;

  PERFORM set_config('app.posting', 'on', true);
  UPDATE landed_costs
     SET final_cost_per_unit = round(p_cost, 6),
         calc_snapshot = calc_snapshot || jsonb_build_object(
           'manual_override', round(p_cost, 6), 'overridden_at', now(), 'overridden_by', auth.uid())
   WHERE order_id = p_order_id;
  PERFORM set_config('app.posting', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION fn_lock_landed_cost(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT app_is_admin() THEN
    RAISE EXCEPTION 'only an admin may lock the landed cost';
  END IF;
  IF (SELECT locked_at FROM landed_costs WHERE order_id = p_order_id) IS NOT NULL THEN
    RAISE EXCEPTION 'landed cost is already locked';
  END IF;

  PERFORM set_config('app.posting', 'on', true);
  UPDATE landed_costs SET locked_at = now(), locked_by = auth.uid()
   WHERE order_id = p_order_id;
  PERFORM set_config('app.posting', '', true);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_recompute_landed_cost(uuid), fn_set_final_landed_cost(uuid, numeric), fn_lock_landed_cost(uuid) TO authenticated;

-- auto-create the landed cost row with the order
CREATE OR REPLACE FUNCTION fn_orders_after_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ccy currency_code;
BEGIN
  SELECT currency INTO v_ccy FROM purchase_invoices WHERE id = NEW.purchase_invoice_id;
  INSERT INTO landed_costs (order_id, currency) VALUES (NEW.id, v_ccy);
  PERFORM fn_recompute_landed_cost(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_ai AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_orders_after_insert();

CREATE TRIGGER trg_orders_guard BEFORE UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_orders_guard();

-- ---------------------------------------------------------------------------
-- POSTING: route expense
--   DR 5100-range import expense (expense currency)
--   CR cash drawer / bank / supplier payable
-- Recomputes landed cost afterwards (if unlocked).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_order_expense(p_expense_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_exp    order_expenses%ROWTYPE;
  v_order  orders%ROWTYPE;
  v_dr     uuid;
  v_cr     uuid;
  v_entry  uuid;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized to post order expenses';
  END IF;

  SELECT * INTO v_exp FROM order_expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order expense not found'; END IF;
  IF v_exp.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft expenses can be posted';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_exp.order_id;

  SELECT id INTO v_dr FROM accounts WHERE code = CASE v_exp.category
    WHEN 'shipping'  THEN '5100'
    WHEN 'surcharge' THEN '5110'
    WHEN 'customs'   THEN '5120'
    WHEN 'transport' THEN '5130'
    ELSE '5140' END;

  IF v_exp.paid_via = 'cash' THEN
    SELECT id INTO v_cr FROM accounts
     WHERE code = CASE v_exp.currency WHEN 'AFN' THEN '1000' ELSE '1001' END;
  ELSIF v_exp.paid_via = 'bank' THEN
    v_cr := fn_ensure_bank_account(v_exp.bank_name);
  ELSE
    -- D-018: 'payable' route expenses are billed by the order's supplier
    SELECT account_id INTO v_cr FROM suppliers WHERE id = v_order.supplier_id;
  END IF;

  v_entry := fn_post_journal(
    v_exp.expense_date,
    'Route expense (' || v_exp.category || ') ' || v_order.doc_no || ': ' || v_exp.description,
    'د لارې لګښت ' || v_order.doc_no || ': ' || coalesce(v_exp.description_ps, ''),  -- DRAFT-PS
    'order_expense', p_expense_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_dr, 'currency', v_exp.currency,
                         'debit', v_exp.amount, 'credit', 0,
                         'fx_rate', v_exp.fx_rate, 'line_memo', v_order.doc_no),
      jsonb_build_object('account_id', v_cr, 'currency', v_exp.currency,
                         'debit', 0, 'credit', v_exp.amount,
                         'fx_rate', v_exp.fx_rate)));

  PERFORM set_config('app.posting', 'on', true);
  UPDATE order_expenses
     SET status = 'posted', posted_by = auth.uid(), posted_at = now()
   WHERE id = p_expense_id;
  PERFORM set_config('app.posting', '', true);

  PERFORM fn_recompute_landed_cost(v_exp.order_id);
  RETURN v_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_post_order_expense(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- POSTING: truck receipt (see cost model at the top of this file)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_truck_receipt(p_receipt_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rec       truck_receipts%ROWTYPE;
  v_order     orders%ROWTYPE;
  v_inv       purchase_invoices%ROWTYPE;
  v_lc        landed_costs%ROWTYPE;
  v_variant   product_variants%ROWTYPE;
  v_c         numeric;   -- invoice unit cost
  v_L         numeric;   -- landed cost per unit
  v_expected  numeric;
  v_done      numeric;
  v_inv_acct  uuid;
  v_alloc     uuid;
  v_dr_inv    numeric;
  v_dr_waste  numeric;
  v_cr_transit numeric;
  v_alloc_amt numeric;
  v_lines     jsonb;
  v_entry     uuid;
  v_new_status order_status;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized to post truck receipts';
  END IF;

  SELECT * INTO v_rec FROM truck_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'truck receipt not found'; END IF;
  IF v_rec.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft receipts can be posted';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_rec.order_id FOR UPDATE;
  IF v_order.status IN ('received', 'closed') THEN
    RAISE EXCEPTION 'order % is already fully received', v_order.doc_no;
  END IF;

  -- cumulative accounting: expected = received + waste + remaining (HC-04)
  v_expected := v_order.containers_total * v_order.units_per_container;
  SELECT coalesce(sum(qty_received + qty_waste), 0) INTO v_done
    FROM truck_receipts WHERE order_id = v_order.id AND status = 'posted';
  IF v_done + v_rec.qty_expected > v_expected THEN
    RAISE EXCEPTION 'receipt exceeds order quantity: % already accounted + % on this truck > % expected',
      v_done, v_rec.qty_expected, v_expected;
  END IF;

  SELECT * INTO v_inv FROM purchase_invoices WHERE id = v_order.purchase_invoice_id;
  SELECT * INTO v_variant FROM product_variants WHERE id = v_order.variant_id;

  -- refresh landed cost (no-op when locked), then read it
  PERFORM fn_recompute_landed_cost(v_order.id);
  SELECT * INTO v_lc FROM landed_costs WHERE order_id = v_order.id;
  v_L := v_lc.final_cost_per_unit;
  v_c := fn_order_unit_cost(v_order.id);

  SELECT id INTO v_inv_acct FROM accounts
   WHERE code = CASE (SELECT category FROM products WHERE id = v_variant.product_id)
                WHEN 'oil' THEN '1200' ELSE '1210' END;
  SELECT id INTO v_alloc FROM accounts WHERE code = '5190';

  v_dr_inv     := round(v_L * v_rec.qty_received, 4);
  v_dr_waste   := round(v_c * v_rec.qty_waste, 4);
  v_cr_transit := round(v_c * (v_rec.qty_received + v_rec.qty_waste), 4);
  -- the expense-capitalization leg takes the exact remainder so the entry
  -- balances to the 4th decimal place
  v_alloc_amt  := v_dr_inv + v_dr_waste - v_cr_transit;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_inv_acct, 'currency', v_inv.currency,
                       'debit', v_dr_inv, 'credit', 0,
                       'line_memo', 'Inventory at landed cost ' || v_L),
    jsonb_build_object('account_id', v_inv.transit_account_id, 'currency', v_inv.currency,
                       'debit', 0, 'credit', v_cr_transit,
                       'line_memo', 'Transit relieved at invoice cost ' || v_c));
  IF v_rec.qty_waste > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_id', (SELECT id FROM accounts WHERE code = '5200'),
      'currency', v_inv.currency, 'debit', v_dr_waste, 'credit', 0,
      'line_memo', 'Waste in transit: ' || v_rec.qty_waste || ' units');
  END IF;
  IF v_alloc_amt > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_alloc, 'currency', v_inv.currency,
      'debit', 0, 'credit', v_alloc_amt,
      'line_memo', 'Route expenses capitalized into inventory');
  ELSIF v_alloc_amt < 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_alloc, 'currency', v_inv.currency,
      'debit', -v_alloc_amt, 'credit', 0,
      'line_memo', 'Landed cost below invoice cost adjustment');
  END IF;

  v_entry := fn_post_journal(
    v_rec.receipt_date,
    'Truck received ' || coalesce(v_rec.truck_ref, '') || ' — ' || v_order.doc_no ||
      ' (' || v_rec.qty_received || ' received, ' || v_rec.qty_waste || ' waste)',
    'لارۍ ورسېده — ' || v_order.doc_no,  -- DRAFT-PS
    'truck_receipt', p_receipt_id, v_lines);

  -- stock into central inventory
  IF v_rec.qty_received > 0 THEN
    INSERT INTO stock_movements (movement_date, variant_id, warehouse_id, movement_type, qty,
                                 unit_cost, cost_currency, source_type, source_id, notes)
    VALUES (v_rec.receipt_date, v_order.variant_id, NULL, 'receive', v_rec.qty_received,
            v_L, v_inv.currency,
            'truck_receipt', p_receipt_id, v_order.doc_no || ' ' || coalesce(v_rec.truck_ref, ''));
  END IF;

  v_new_status := CASE
    WHEN v_done + v_rec.qty_expected = v_expected THEN 'received'::order_status
    ELSE 'partially_received'::order_status END;

  PERFORM set_config('app.posting', 'on', true);
  UPDATE truck_receipts
     SET status = 'posted', posted_by = auth.uid(), posted_at = now()
   WHERE id = p_receipt_id;
  UPDATE orders SET status = v_new_status WHERE id = v_order.id;
  PERFORM set_config('app.posting', '', true);

  RETURN v_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_post_truck_receipt(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Close an order (fully received; office/admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_close_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status order_status;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT status INTO v_status FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF v_status <> 'received' THEN
    RAISE EXCEPTION 'only fully received orders can be closed (order is %)', v_status;
  END IF;
  PERFORM set_config('app.posting', 'on', true);
  UPDATE orders SET status = 'closed' WHERE id = p_order_id;
  PERFORM set_config('app.posting', '', true);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_close_order(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Order status view (expected / received / waste / remaining — HC-04 shape)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_order_status WITH (security_invoker = true) AS
SELECT o.id, o.doc_no, o.order_date, o.status,
       o.supplier_id, o.variant_id, o.purchase_invoice_id,
       o.trucks_total, o.containers_total, o.units_per_container,
       o.containers_total * o.units_per_container            AS qty_expected,
       coalesce(r.received, 0)                               AS qty_received,
       coalesce(r.waste, 0)                                  AS qty_waste,
       o.containers_total * o.units_per_container
         - coalesce(r.received, 0) - coalesce(r.waste, 0)    AS qty_remaining,
       coalesce(r.trucks_received, 0)                        AS trucks_received,
       o.trucks_total - coalesce(r.trucks_received, 0)       AS trucks_remaining
  FROM orders o
  LEFT JOIN (
    SELECT order_id,
           sum(qty_received) AS received,
           sum(qty_waste)    AS waste,
           count(*)          AS trucks_received
      FROM truck_receipts
     WHERE status = 'posted'
     GROUP BY order_id
  ) r ON r.order_id = o.id;

-- ---------------------------------------------------------------------------
-- Immutability + RLS + audit
-- ---------------------------------------------------------------------------
SELECT fn_enable_doc_immutability('truck_receipts');
SELECT fn_enable_doc_immutability('order_expenses');

ALTER TABLE orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE truck_receipts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_expenses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE landed_costs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select ON orders FOR SELECT TO authenticated USING (app_is_office());
CREATE POLICY orders_insert ON orders FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY orders_update ON orders FOR UPDATE TO authenticated
  USING (app_is_office()) WITH CHECK (app_is_office());

CREATE POLICY tr_select ON truck_receipts FOR SELECT TO authenticated USING (app_is_office());
CREATE POLICY tr_insert ON truck_receipts FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY tr_update ON truck_receipts FOR UPDATE TO authenticated
  USING (app_is_office() AND status = 'draft') WITH CHECK (app_is_office() AND status = 'draft');
CREATE POLICY tr_delete ON truck_receipts FOR DELETE TO authenticated
  USING (status = 'draft' AND (created_by = auth.uid() OR app_is_admin()));

CREATE POLICY oe_select ON order_expenses FOR SELECT TO authenticated USING (app_is_office());
CREATE POLICY oe_insert ON order_expenses FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY oe_update ON order_expenses FOR UPDATE TO authenticated
  USING (app_is_office() AND status = 'draft') WITH CHECK (app_is_office() AND status = 'draft');
CREATE POLICY oe_delete ON order_expenses FOR DELETE TO authenticated
  USING (status = 'draft' AND (created_by = auth.uid() OR app_is_admin()));

CREATE POLICY lc_select ON landed_costs FOR SELECT TO authenticated USING (app_is_office());
-- landed_costs: no write policies — functions only

-- stock: office sees all; warehouse keepers see their own سرای rows
CREATE POLICY sm_select ON stock_movements FOR SELECT TO authenticated
  USING (app_is_office() OR warehouse_id = app_current_warehouse());
-- no write policies — stock moves only through posting functions

GRANT SELECT, INSERT, UPDATE, DELETE ON orders, truck_receipts, order_expenses TO authenticated;
GRANT SELECT ON landed_costs, stock_movements, v_stock_levels, v_order_status TO authenticated;

SELECT fn_enable_audit(t)
  FROM unnest(ARRAY['orders', 'truck_receipts', 'order_expenses', 'landed_costs', 'stock_movements']::regclass[]) AS t;
SELECT fn_enable_touch(t)
  FROM unnest(ARRAY['orders', 'truck_receipts', 'order_expenses', 'landed_costs']::regclass[]) AS t;
