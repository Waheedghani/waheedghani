-- ============================================================================
-- Phase 4 tests: order book, truck receipts, waste, route expenses, landed
-- cost — exact NUMERIC assertions per the spec fixture:
--   3 containers x 1150 x $12.7350 (posted in phase 3), 2 route expenses
--   ($850 bank + ؋21,375 cash @ 71.25 = $300), truck 1 with 18 bottles waste.
-- ============================================================================

DO $t$
DECLARE
  office_id uuid := md5('test-user:office1')::uuid;
  admin_id  uuid := md5('test-user:admin1')::uuid;
  v_inv     uuid;
  v_variant uuid;
  v_order   uuid;
  v_doc     text;
  v_exp1    uuid;
  v_exp2    uuid;
  v_t1      uuid;
  v_t2      uuid;
  v_auto    numeric;
  v_final   numeric;
  v_transit uuid;
  v_invacct uuid := NULL;
  v_qty     numeric;
  v_st      record;
BEGIN
  SELECT id, transit_account_id INTO v_inv, v_transit
    FROM purchase_invoices WHERE doc_no = 'PI-2026-0001';
  SELECT id INTO v_variant FROM product_variants WHERE label = '16L Bottle';
  PERFORM tests.ok(v_inv IS NOT NULL, 'posted purchase invoice present');

  PERFORM tests.login(office_id);

  ------------------------------------------------------------------
  -- Create order: 2 trucks, 3 containers x 1150 = 3450 bottles
  ------------------------------------------------------------------
  INSERT INTO orders (order_date, purchase_invoice_id, supplier_id, variant_id,
                      trucks_total, containers_total, units_per_container,
                      bill_number, container_numbers)
  VALUES (DATE '2026-07-03', v_inv,
          (SELECT supplier_id FROM purchase_invoices WHERE id = v_inv),
          v_variant, 2, 3, 1150, 'BILL-071',
          ARRAY['MSKU-771001', 'MSKU-771002', 'MSKU-771003'])
  RETURNING id, doc_no INTO v_order, v_doc;

  PERFORM tests.ok(v_doc = 'ORD-2026-0001', 'order numbered at creation, got ' || v_doc);
  SELECT auto_cost_per_unit INTO v_auto FROM landed_costs WHERE order_id = v_order;
  PERFORM tests.eq(v_auto, 12.735000, 'landed cost = invoice cost before expenses');

  ------------------------------------------------------------------
  -- Route expenses: $850 via bank; ؋21,375 cash at 71.25 (= $300 exactly)
  ------------------------------------------------------------------
  INSERT INTO order_expenses (order_id, expense_date, category, description, currency, amount, paid_via, bank_name)
  VALUES (v_order, DATE '2026-07-04', 'shipping', 'Sea + land freight surcharge', 'USD', 850.0000, 'bank', 'Maybank')
  RETURNING id INTO v_exp1;
  INSERT INTO order_expenses (order_id, expense_date, category, description, currency, amount, fx_rate, paid_via)
  VALUES (v_order, DATE '2026-07-05', 'surcharge', 'War-route security fee', 'AFN', 21375.0000, 71.25, 'cash')
  RETURNING id INTO v_exp2;

  PERFORM fn_post_order_expense(v_exp1);
  PERFORM fn_post_order_expense(v_exp2);

  SELECT auto_cost_per_unit INTO v_auto FROM landed_costs WHERE order_id = v_order;
  -- (12.7350*3450 + 1150) / 3450 = 13.068333 (6 dp)
  PERFORM tests.eq(v_auto, 13.068333, 'landed cost after expenses');

  -- AFN cash left the drawer
  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE code = '1000'), 'AFN'),
                   100000.5000 - 21375.0000, 'AFN drawer after route expense');

  ------------------------------------------------------------------
  -- Truck 1: 1725 expected, 1707 received, 18 waste
  ------------------------------------------------------------------
  -- receipt math CHECK: received + waste must equal expected
  PERFORM tests.throws(format(
    'INSERT INTO truck_receipts (order_id, receipt_date, truck_ref, containers, qty_expected, qty_received, qty_waste)
     VALUES (%L, DATE ''2026-07-08'', ''KBL-401'', 2, 1725, 1700, 18)', v_order),
    '%tr_qty_math%');

  INSERT INTO truck_receipts (order_id, receipt_date, truck_ref, containers, qty_expected, qty_received, qty_waste)
  VALUES (v_order, DATE '2026-07-08', 'KBL-401', 2, 1725, 1707, 18)
  RETURNING id INTO v_t1;
  PERFORM fn_post_truck_receipt(v_t1);

  SELECT status INTO v_st FROM orders WHERE id = v_order;
  PERFORM tests.ok(v_st.status = 'partially_received', 'order partially received');

  SELECT id INTO v_invacct FROM accounts WHERE code = '1200';
  -- truck 1 posted at L=13.068333: DR inv 22,307.6444; DR waste 229.2300;
  -- CR transit 21,967.8750; CR 5190 568.9994
  PERFORM tests.eq(fn_account_balance(v_invacct, 'USD'), 22307.6444, 'inventory after truck 1');
  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE code = '5200'), 'USD'),
                   229.2300, 'waste expense at invoice cost');
  PERFORM tests.eq(fn_account_balance(v_transit, 'USD'), 43935.7500 - 21967.8750, 'transit after truck 1');

  ------------------------------------------------------------------
  -- Truck 2: remaining 1725, no waste — landed cost now spreads expenses
  -- over 3432 units: 12.735 + 1150/3432 = 13.070082
  ------------------------------------------------------------------
  INSERT INTO truck_receipts (order_id, receipt_date, truck_ref, containers, qty_expected, qty_received, qty_waste)
  VALUES (v_order, DATE '2026-07-12', 'KBL-402', 1, 1725, 1725, 0)
  RETURNING id INTO v_t2;
  PERFORM fn_post_truck_receipt(v_t2);

  SELECT final_cost_per_unit INTO v_final FROM landed_costs WHERE order_id = v_order;
  PERFORM tests.eq(v_final, 13.070082, 'landed cost reflects waste-reduced denominator');

  -- transit fully drained — to the exact pul/cent
  PERFORM tests.eq(fn_account_balance(v_transit, 'USD'), 0, 'goods in transit nets to zero');
  -- inventory = 22,307.6444 + 22,545.8915
  PERFORM tests.eq(fn_account_balance(v_invacct, 'USD'), 44853.5359, 'inventory after both trucks');
  -- capitalization contra ≈ total expenses (rounding stays in 5190)
  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE code = '5190'), 'USD'),
                   -1147.0159, 'route expenses capitalized');

  -- order status: fully received; HC-04 identity
  SELECT * INTO v_st FROM v_order_status WHERE id = v_order;
  PERFORM tests.eq(v_st.qty_expected, 3450, 'expected qty');
  PERFORM tests.eq(v_st.qty_received, 3432, 'received qty');
  PERFORM tests.eq(v_st.qty_waste, 18, 'waste qty');
  PERFORM tests.eq(v_st.qty_remaining, 0, 'remaining qty');
  PERFORM tests.ok(v_st.status = 'received', 'order received');
  PERFORM tests.eq(v_st.trucks_remaining, 0, 'trucks remaining');

  -- central stock
  SELECT qty INTO v_qty FROM v_stock_levels WHERE variant_id = v_variant AND warehouse_id IS NULL;
  PERFORM tests.eq(v_qty, 3432, 'central stock after receiving');

  -- over-receipt rejected
  INSERT INTO truck_receipts (order_id, receipt_date, qty_expected, qty_received, qty_waste)
  VALUES (v_order, DATE '2026-07-13', 100, 100, 0) RETURNING id INTO v_t1;
  PERFORM tests.throws(format('SELECT fn_post_truck_receipt(%L)', v_t1), '%already fully received%');
  DELETE FROM truck_receipts WHERE id = v_t1;

  -- orders can never be deleted: RLS gives office no DELETE at all
  DELETE FROM orders WHERE id = v_order;
  GET DIAGNOSTICS v_qty = ROW_COUNT;
  PERFORM tests.eq(v_qty, 0, 'RLS: office cannot delete an order');

  ------------------------------------------------------------------
  -- Landed cost: admin-only editing and locking
  ------------------------------------------------------------------
  PERFORM tests.throws(format('SELECT fn_set_final_landed_cost(%L, 13.10)', v_order), '%only an admin%');
  PERFORM tests.throws(format('SELECT fn_lock_landed_cost(%L)', v_order), '%only an admin%');
  PERFORM tests.logout();

  PERFORM tests.login(admin_id);
  PERFORM fn_set_final_landed_cost(v_order, 13.10);
  SELECT final_cost_per_unit, auto_cost_per_unit INTO v_final, v_auto FROM landed_costs WHERE order_id = v_order;
  PERFORM tests.eq(v_final, 13.100000, 'admin override applied');
  -- recompute keeps the manual override
  PERFORM fn_recompute_landed_cost(v_order);
  SELECT final_cost_per_unit INTO v_final FROM landed_costs WHERE order_id = v_order;
  PERFORM tests.eq(v_final, 13.100000, 'override survives recompute');

  PERFORM fn_lock_landed_cost(v_order);
  PERFORM tests.throws(format('SELECT fn_set_final_landed_cost(%L, 14)', v_order), '%locked%');
  PERFORM tests.logout();

  -- direct tampering with landed_costs blocked even for superuser
  PERFORM tests.throws(format('UPDATE landed_costs SET final_cost_per_unit = 1 WHERE order_id = %L', v_order),
    '%only through%');

  -- trigger layer: even bypassing RLS, orders can never be deleted
  PERFORM tests.throws(format('DELETE FROM orders WHERE id = %L', v_order), '%never be deleted%');

  ------------------------------------------------------------------
  -- stock movements are immutable facts
  ------------------------------------------------------------------
  PERFORM tests.throws('UPDATE stock_movements SET qty = qty + 1', '%immutable%');
  PERFORM tests.throws('DELETE FROM stock_movements', '%immutable%');
END
$t$;
