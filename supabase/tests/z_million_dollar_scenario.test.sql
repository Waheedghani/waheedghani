-- ============================================================================
-- THE MILLION-DOLLAR SCENARIO (spec §13) — one continuous end-to-end flow
-- with every balance asserted to the cent/pul at each step.
--
--   1 supplier · invoice 3 containers × 1,150 bottles at $12.7350
--   advance $10,000 · 2 route expenses ($850 bank + ؋21,375 cash @ 71.25)
--   1 truck with 18 bottles waste · dispatch to 2 warehouses at different
--   prices · partial AFN payment at rate 71.25 · saraf payment with hawala
--   number · office expense · day close.
--
-- Runs on FRESH parties and the (untouched) 20L variant so the scenario is
-- self-contained; shared accounts (drawer, inventory, revenue …) are asserted
-- as exact DELTAS from captured baselines.
-- ============================================================================

DO $t$
DECLARE
  office_id uuid := md5('test-user:office1')::uuid;
  admin_id  uuid := md5('test-user:admin1')::uuid;
  v_variant uuid;
  v_sup     uuid;
  v_sup_acct uuid;
  whA warehouses%ROWTYPE;
  whB warehouses%ROWTYPE;
  v_saraf   sarafs%ROWTYPE;
  v_inv     uuid;
  v_transit uuid;
  v_pay     uuid;
  v_order   uuid;
  e1 uuid; e2 uuid;
  v_truck   uuid;
  dA uuid; dB uuid;
  pA uuid; pB uuid;
  v_exp     uuid;
  -- baselines
  b_afn numeric; b_usd numeric; b_1200 numeric;
  b_4000u numeric; b_4000a numeric; b_5000 numeric;
  b_5100 numeric; b_5110 numeric; b_5190 numeric; b_5200 numeric;
  b_3900a numeric; b_3900u numeric;
  a_1000 uuid; a_1001 uuid; a_1200 uuid; a_4000 uuid; a_5000 uuid;
  a_5100 uuid; a_5110 uuid; a_5190 uuid; a_5200 uuid; a_3900 uuid;
  v_lc numeric;
  v_age record;
  v_run uuid;
BEGIN
  SELECT id INTO v_variant FROM product_variants WHERE label = '20L Bottle';
  SELECT id INTO a_1000 FROM accounts WHERE code = '1000';
  SELECT id INTO a_1001 FROM accounts WHERE code = '1001';
  SELECT id INTO a_1200 FROM accounts WHERE code = '1200';
  SELECT id INTO a_4000 FROM accounts WHERE code = '4000';
  SELECT id INTO a_5000 FROM accounts WHERE code = '5000';
  SELECT id INTO a_5100 FROM accounts WHERE code = '5100';
  SELECT id INTO a_5110 FROM accounts WHERE code = '5110';
  SELECT id INTO a_5190 FROM accounts WHERE code = '5190';
  SELECT id INTO a_5200 FROM accounts WHERE code = '5200';
  SELECT id INTO a_3900 FROM accounts WHERE code = '3900';

  b_afn   := fn_account_balance(a_1000, 'AFN');
  b_usd   := fn_account_balance(a_1001, 'USD');
  b_1200  := fn_account_balance(a_1200, 'USD');
  b_4000u := fn_account_balance(a_4000, 'USD');
  b_4000a := fn_account_balance(a_4000, 'AFN');
  b_5000  := fn_account_balance(a_5000, 'USD');
  b_5100  := fn_account_balance(a_5100, 'USD');
  b_5110  := fn_account_balance(a_5110, 'AFN');
  b_5190  := fn_account_balance(a_5190, 'USD');
  b_5200  := fn_account_balance(a_5200, 'USD');
  b_3900a := fn_account_balance(a_3900, 'AFN');
  b_3900u := fn_account_balance(a_3900, 'USD');

  PERFORM tests.login(office_id);

  ------------------------------------------------------------------
  -- Fresh parties
  ------------------------------------------------------------------
  INSERT INTO suppliers (name, name_ps) VALUES ('PGEO Edible Oils', 'پي جي اي او')
  RETURNING id, account_id INTO v_sup, v_sup_acct;
  INSERT INTO warehouses (name, name_ps, keeper_name) VALUES ('Sarai Herat', 'سرای هرات', 'Haji Tor')
  RETURNING * INTO whA;
  INSERT INTO warehouses (name, name_ps, keeper_name) VALUES ('Sarai Mazar', 'سرای مزار', 'Haji Gul')
  RETURNING * INTO whB;
  INSERT INTO sarafs (name, name_ps) VALUES ('Saraf Qandahari', 'صرافي کندهاري')
  RETURNING * INTO v_saraf;

  ------------------------------------------------------------------
  -- STEP 1 — Purchase invoice: 3 × 1,150 × $12.7350 = $43,935.7500
  ------------------------------------------------------------------
  INSERT INTO purchase_invoices (invoice_date, supplier_id, invoice_number_supplier,
                                 bill_of_lading, bank_name, currency, advance_payment, bank_balance_due)
  VALUES (DATE '2026-08-01', v_sup, 'PG-2026-771', 'BL-PG-1188', 'CIMB Bank', 'USD',
          10000.0000, 33935.7500)
  RETURNING id INTO v_inv;
  INSERT INTO purchase_invoice_lines (invoice_id, variant_id, containers_count,
                                      units_per_container, price_per_unit, container_numbers)
  VALUES (v_inv, v_variant, 3, 1150, 12.7350, ARRAY['PGEO-9001', 'PGEO-9002', 'PGEO-9003']);
  PERFORM fn_post_purchase_invoice(v_inv);

  SELECT transit_account_id INTO v_transit FROM purchase_invoices WHERE id = v_inv;
  PERFORM tests.eq(fn_account_balance(v_transit, 'USD'),  43935.7500, 'S1: goods in transit');
  PERFORM tests.eq(fn_account_balance(v_sup_acct, 'USD'), -43935.7500, 'S1: supplier payable');

  ------------------------------------------------------------------
  -- STEP 2 — Advance $10,000 cash
  ------------------------------------------------------------------
  INSERT INTO supplier_payments (payment_date, supplier_id, purchase_invoice_id, kind, method, currency, amount)
  VALUES (DATE '2026-08-01', v_sup, v_inv, 'advance', 'cash', 'USD', 10000.0000)
  RETURNING id INTO v_pay;
  PERFORM fn_post_supplier_payment(v_pay);

  PERFORM tests.eq(fn_account_balance(v_sup_acct, 'USD'), -33935.7500, 'S2: payable after advance');
  PERFORM tests.eq(fn_account_balance(a_1001, 'USD') - b_usd, -10000.0000, 'S2: USD drawer delta');

  ------------------------------------------------------------------
  -- STEP 3 — Order + 2 route expenses ($850 bank, ؋21,375 cash @ 71.25 = $300)
  ------------------------------------------------------------------
  INSERT INTO orders (order_date, purchase_invoice_id, supplier_id, variant_id,
                      trucks_total, containers_total, units_per_container, bill_number)
  VALUES (DATE '2026-08-02', v_inv, v_sup, v_variant, 1, 3, 1150, 'BILL-M1')
  RETURNING id INTO v_order;

  INSERT INTO order_expenses (order_id, expense_date, category, description, currency, amount, paid_via, bank_name)
  VALUES (v_order, DATE '2026-08-04', 'shipping', 'Ocean + border freight', 'USD', 850.0000, 'bank', 'CIMB Bank')
  RETURNING id INTO e1;
  INSERT INTO order_expenses (order_id, expense_date, category, description, currency, amount, fx_rate, paid_via)
  VALUES (v_order, DATE '2026-08-05', 'surcharge', 'Route security fee', 'AFN', 21375.0000, 71.25, 'cash')
  RETURNING id INTO e2;
  PERFORM fn_post_order_expense(e1);
  PERFORM fn_post_order_expense(e2);

  SELECT final_cost_per_unit INTO v_lc FROM landed_costs WHERE order_id = v_order;
  PERFORM tests.eq(v_lc, 13.068333, 'S3: landed cost (12.7350·3450 + 1150)/3450');
  PERFORM tests.eq(fn_account_balance(a_5100, 'USD') - b_5100, 850.0000,   'S3: shipping expense USD');
  PERFORM tests.eq(fn_account_balance(a_5110, 'AFN') - b_5110, 21375.0000, 'S3: surcharge expense AFN');
  PERFORM tests.eq(fn_account_balance(a_1000, 'AFN') - b_afn, -21375.0000, 'S3: AFN drawer delta');
  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE type = 'bank' AND name = 'CIMB Bank'), 'USD'),
                   -850.0000, 'S3: bank credited');

  ------------------------------------------------------------------
  -- STEP 4 — One truck arrives: 3,432 received, 18 waste
  ------------------------------------------------------------------
  INSERT INTO truck_receipts (order_id, receipt_date, truck_ref, containers, qty_expected, qty_received, qty_waste)
  VALUES (v_order, DATE '2026-08-08', 'HRT-901', 3, 3450, 3432, 18)
  RETURNING id INTO v_truck;
  PERFORM fn_post_truck_receipt(v_truck);

  PERFORM tests.eq(fn_account_balance(v_transit, 'USD'), 0, 'S4: transit drains to exactly zero');
  PERFORM tests.eq(fn_account_balance(a_1200, 'USD') - b_1200, 44850.5189, 'S4: inventory at landed cost');
  PERFORM tests.eq(fn_account_balance(a_5200, 'USD') - b_5200, 229.2300, 'S4: waste absorbed at invoice cost');
  PERFORM tests.eq(fn_account_balance(a_5190, 'USD') - b_5190, -1143.9989, 'S4: expenses capitalized');
  PERFORM tests.eq((SELECT qty FROM v_stock_levels WHERE variant_id = v_variant AND warehouse_id IS NULL),
                   3432, 'S4: central stock');
  PERFORM tests.ok((SELECT status FROM orders WHERE id = v_order) = 'received', 'S4: order fully received');

  ------------------------------------------------------------------
  -- STEP 5 — Dispatch to 2 warehouses at different prices
  --   A: 1,200 @ $14.25 (USD) · B: 800 @ ؋1,015 (AFN)
  ------------------------------------------------------------------
  INSERT INTO dispatch_invoices (dispatch_date, warehouse_id, currency)
  VALUES (DATE '2026-08-09', whA.id, 'USD') RETURNING id INTO dA;
  INSERT INTO dispatch_lines (dispatch_id, variant_id, qty, price_per_unit)
  VALUES (dA, v_variant, 1200, 14.2500);
  PERFORM fn_post_dispatch(dA);

  PERFORM tests.eq(fn_account_balance(whA.account_id, 'USD'), 17100.0000, 'S5: warehouse A owes USD');
  PERFORM tests.eq(fn_account_balance(a_5000, 'USD') - b_5000, 15681.9996, 'S5: COGS A at avg landed cost');

  INSERT INTO dispatch_invoices (dispatch_date, warehouse_id, currency, fx_rate)
  VALUES (DATE '2026-08-09', whB.id, 'AFN', 71.25) RETURNING id INTO dB;
  INSERT INTO dispatch_lines (dispatch_id, variant_id, qty, price_per_unit)
  VALUES (dB, v_variant, 800, 1015.0000);
  PERFORM fn_post_dispatch(dB);

  PERFORM tests.eq(fn_account_balance(whB.account_id, 'AFN'), 812000.0000, 'S5: warehouse B owes AFN');
  PERFORM tests.eq(fn_account_balance(a_4000, 'USD') - b_4000u, -17100.0000, 'S5: USD revenue');
  PERFORM tests.eq(fn_account_balance(a_4000, 'AFN') - b_4000a, -812000.0000, 'S5: AFN revenue');
  PERFORM tests.eq(fn_account_balance(a_5000, 'USD') - b_5000, 15681.9996 + 10454.6664, 'S5: total COGS');
  PERFORM tests.eq(fn_account_balance(a_1200, 'USD') - b_1200,
                   44850.5189 - 15681.9996 - 10454.6664, 'S5: inventory after dispatches');
  PERFORM tests.eq((SELECT qty FROM v_stock_levels WHERE variant_id = v_variant AND warehouse_id IS NULL),
                   1432, 'S5: central stock');

  ------------------------------------------------------------------
  -- STEP 6 — Partial AFN payment at rate 71.25:
  --   warehouse A pays ؋427,500 settling $6,000 of its USD debt
  ------------------------------------------------------------------
  INSERT INTO warehouse_payments (payment_date, warehouse_id, currency, amount,
                                  settle_currency, fx_rate, method, bill_refs)
  VALUES (DATE '2026-08-09', whA.id, 'AFN', 427500.0000, 'USD', 71.25, 'cash',
          ARRAY[(SELECT doc_no FROM dispatch_invoices WHERE id = dA)])
  RETURNING id INTO pA;
  PERFORM fn_post_warehouse_payment(pA);

  PERFORM tests.eq(fn_account_balance(whA.account_id, 'USD'), 11100.0000, 'S6: A after partial payment');
  PERFORM tests.eq(fn_account_balance(a_1000, 'AFN') - b_afn, -21375.0000 + 427500.0000, 'S6: AFN drawer delta');
  PERFORM tests.eq(fn_account_balance(a_3900, 'AFN') - b_3900a, -427500.0000, 'S6: FX clearing AFN');
  PERFORM tests.eq(fn_account_balance(a_3900, 'USD') - b_3900u, 6000.0000, 'S6: FX clearing USD');

  ------------------------------------------------------------------
  -- STEP 7 — Saraf payment with hawala number:
  --   warehouse B sends ؋300,000 via Saraf Qandahari (HW-77001)
  ------------------------------------------------------------------
  INSERT INTO warehouse_payments (payment_date, warehouse_id, currency, amount,
                                  method, saraf_id, hawala_number, bill_refs)
  VALUES (DATE '2026-08-10', whB.id, 'AFN', 300000.0000, 'saraf', v_saraf.id, 'HW-77001',
          ARRAY[(SELECT doc_no FROM dispatch_invoices WHERE id = dB)])
  RETURNING id INTO pB;
  PERFORM fn_post_warehouse_payment(pB);

  PERFORM tests.eq(fn_account_balance(whB.account_id, 'AFN'), 512000.0000, 'S7: B after saraf payment');
  PERFORM tests.eq(fn_account_balance(v_saraf.account_id, 'AFN'), 300000.0000, 'S7: saraf holds the hawala');
  PERFORM tests.ok(EXISTS (SELECT 1 FROM saraf_transactions
    WHERE linked_source_id = pB AND hawala_number = 'HW-77001' AND status = 'posted'),
    'S7: hawala registered');
  -- the saraf money is NOT in the drawer (Roznamcha untouched by this step)
  PERFORM tests.eq(fn_account_balance(a_1000, 'AFN') - b_afn, 406125.0000, 'S7: drawer unchanged by saraf');

  ------------------------------------------------------------------
  -- STEP 8 — Office expense ؋12,000 cash
  ------------------------------------------------------------------
  INSERT INTO office_expenses (expense_date, category_id, description, currency, amount, paid_via)
  VALUES (DATE '2026-08-10', (SELECT id FROM expense_categories WHERE name = 'Rent'),
          'August office rent', 'AFN', 12000.0000, 'cash')
  RETURNING id INTO v_exp;
  PERFORM fn_post_office_expense(v_exp);

  PERFORM tests.eq(fn_account_balance(a_1000, 'AFN') - b_afn, 394125.0000, 'S8: AFN drawer delta');

  ------------------------------------------------------------------
  -- STEP 9 — Day close (2026-08-10): counted = computed, variance zero
  ------------------------------------------------------------------
  PERFORM fn_close_roznamcha_day(DATE '2026-08-10',
    fn_account_balance(a_1000, 'AFN', DATE '2026-08-10'),
    fn_account_balance(a_1001, 'USD', DATE '2026-08-10'));

  PERFORM tests.eq((SELECT variance_afn FROM roznamcha_days WHERE day_date = DATE '2026-08-10'), 0,
    'S9: AFN variance zero');
  PERFORM tests.eq((SELECT variance_usd FROM roznamcha_days WHERE day_date = DATE '2026-08-10'), 0,
    'S9: USD variance zero');

  ------------------------------------------------------------------
  -- STEP 10 — Receivables aging shows the open balances
  ------------------------------------------------------------------
  SELECT * INTO v_age FROM fn_receivables_aging(DATE '2026-08-12')
   WHERE warehouse_id = whA.id AND currency = 'USD';
  PERFORM tests.eq(v_age.total, 11100.0000, 'S10: A aging total');
  SELECT * INTO v_age FROM fn_receivables_aging(DATE '2026-08-12')
   WHERE warehouse_id = whB.id AND currency = 'AFN';
  PERFORM tests.eq(v_age.total, 512000.0000, 'S10: B aging total');

  PERFORM tests.logout();

  ------------------------------------------------------------------
  -- FINAL — the health suite blesses the whole scenario
  ------------------------------------------------------------------
  PERFORM tests.login(admin_id);
  v_run := fn_run_health_checks();
  DECLARE
    v_msg text;
  BEGIN
    SELECT string_agg(check_code || '=' || severity || ' ' || details::text, ' | ')
      INTO v_msg
      FROM data_health_results WHERE run_id = v_run AND severity <> 'ok';
    PERFORM tests.ok(v_msg IS NULL, 'FINAL: all 12 health checks green — ' || coalesce(v_msg, ''));
  END;
  PERFORM tests.logout();
END
$t$;
