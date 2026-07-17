-- ============================================================================
-- Phase 5 tests: dispatch (revenue + moving-average COGS), cross-currency
-- warehouse payments via 3900, saraf-routed payments, pickups, portal RLS.
-- State from earlier phases: central 16L stock = 3432 bottles,
-- pool value $44,853.5359 → avg cost 13.069212.
-- ============================================================================

DO $t$
DECLARE
  office_id uuid := md5('test-user:office1')::uuid;
  keeper1   uuid := md5('test-user:keeper1')::uuid;
  keeper2   uuid := md5('test-user:keeper2')::uuid;
  v_variant uuid;
  wh1       warehouses%ROWTYPE;
  wh2       warehouses%ROWTYPE;
  v_saraf   sarafs%ROWTYPE;
  d1 uuid; d2 uuid; bad uuid;
  p1 uuid; p2 uuid; p3 uuid;
  v_cnt int;
  v_qty numeric;
  v_pick uuid;
  v_inv1200 uuid;
  v_age record;
BEGIN
  SELECT id INTO v_variant FROM product_variants WHERE label = '16L Bottle';
  SELECT * INTO wh1 FROM warehouses WHERE name = 'Sarai Kabul North';
  SELECT * INTO wh2 FROM warehouses WHERE name = 'Sarai Jalalabad';
  SELECT * INTO v_saraf FROM sarafs WHERE name = 'Saraf Ahmadi';
  SELECT id INTO v_inv1200 FROM accounts WHERE code = '1200';

  PERFORM tests.login(office_id);

  ------------------------------------------------------------------
  -- Dispatch 1: 1000 bottles @ $14.50 to wh1 (USD)
  ------------------------------------------------------------------
  INSERT INTO dispatch_invoices (dispatch_date, warehouse_id, currency)
  VALUES (DATE '2026-07-14', wh1.id, 'USD') RETURNING id INTO d1;
  INSERT INTO dispatch_lines (dispatch_id, variant_id, qty, price_per_unit)
  VALUES (d1, v_variant, 1000, 14.5000);
  PERFORM fn_post_dispatch(d1);

  PERFORM tests.ok((SELECT doc_no FROM dispatch_invoices WHERE id = d1) = 'DSP-2026-0001',
    'dispatch doc no assigned');
  PERFORM tests.eq(fn_account_balance(wh1.account_id, 'USD'), 14500.0000, 'wh1 receivable debited');
  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE code = '4000'), 'USD'),
                   -14500.0000, 'oil revenue credited');
  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE code = '5000'), 'USD'),
                   13069.2120, 'COGS at moving-average landed cost');
  PERFORM tests.eq(fn_account_balance(v_inv1200, 'USD'),
                   44853.5359 - 13069.2120, 'inventory relieved');
  PERFORM tests.eq((SELECT qty FROM v_stock_levels WHERE variant_id = v_variant AND warehouse_id IS NULL),
                   2432, 'central stock after dispatch 1');
  PERFORM tests.eq((SELECT qty FROM v_stock_levels WHERE variant_id = v_variant AND warehouse_id = wh1.id),
                   1000, 'wh1 custody stock');

  ------------------------------------------------------------------
  -- Dispatch 2: 500 bottles @ ؋1,030 to wh2 (AFN revenue, USD COGS —
  -- multi-currency entry balanced per currency)
  ------------------------------------------------------------------
  INSERT INTO dispatch_invoices (dispatch_date, warehouse_id, currency, fx_rate)
  VALUES (DATE '2026-07-14', wh2.id, 'AFN', 71.25) RETURNING id INTO d2;
  INSERT INTO dispatch_lines (dispatch_id, variant_id, qty, price_per_unit)
  VALUES (d2, v_variant, 500, 1030.0000);
  PERFORM fn_post_dispatch(d2);

  PERFORM tests.eq(fn_account_balance(wh2.account_id, 'AFN'), 515000.0000, 'wh2 receivable in AFN');
  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE code = '5000'), 'USD'),
                   13069.2120 + 6534.6060, 'COGS accumulates in USD pool currency');
  PERFORM tests.eq(fn_account_balance(v_inv1200, 'USD'), 25249.7179, 'inventory after both dispatches');

  ------------------------------------------------------------------
  -- Insufficient stock is rejected
  ------------------------------------------------------------------
  INSERT INTO dispatch_invoices (dispatch_date, warehouse_id, currency)
  VALUES (DATE '2026-07-15', wh1.id, 'USD') RETURNING id INTO bad;
  INSERT INTO dispatch_lines (dispatch_id, variant_id, qty, price_per_unit)
  VALUES (bad, v_variant, 5000, 15);
  PERFORM tests.throws(format('SELECT fn_post_dispatch(%L)', bad), '%insufficient stock%');
  DELETE FROM dispatch_invoices WHERE id = bad;

  ------------------------------------------------------------------
  -- Payment 1: wh2 pays ؋200,000 cash (same currency, partial — typical)
  ------------------------------------------------------------------
  INSERT INTO warehouse_payments (payment_date, warehouse_id, currency, amount, method, bill_refs)
  VALUES (DATE '2026-07-15', wh2.id, 'AFN', 200000.0000, 'cash', ARRAY['DSP-2026-0002'])
  RETURNING id INTO p1;
  PERFORM fn_post_warehouse_payment(p1);
  PERFORM tests.eq(fn_account_balance(wh2.account_id, 'AFN'), 315000.0000, 'wh2 balance after partial cash');

  ------------------------------------------------------------------
  -- Payment 2: wh1 pays ؋356,250 cash settling USD at 71.25 (= $5,000)
  ------------------------------------------------------------------
  INSERT INTO warehouse_payments (payment_date, warehouse_id, currency, amount,
                                  settle_currency, fx_rate, method, bill_refs)
  VALUES (DATE '2026-07-15', wh1.id, 'AFN', 356250.0000, 'USD', 71.25, 'cash', ARRAY['DSP-2026-0001'])
  RETURNING id INTO p2;
  PERFORM fn_post_warehouse_payment(p2);

  PERFORM tests.eq(fn_account_balance(wh1.account_id, 'USD'), 9500.0000, 'wh1 USD settled via FX clearing');
  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE code = '3900'), 'AFN'),
                   -356250.0000, 'FX clearing AFN leg');
  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE code = '3900'), 'USD'),
                   5000.0000, 'FX clearing USD leg');

  ------------------------------------------------------------------
  -- Payment 3: wh1 pays $2,000 through the saraf (hawala)
  ------------------------------------------------------------------
  INSERT INTO warehouse_payments (payment_date, warehouse_id, currency, amount,
                                  method, saraf_id, hawala_number, bill_refs)
  VALUES (DATE '2026-07-16', wh1.id, 'USD', 2000.0000, 'saraf', v_saraf.id, 'HW-88991', ARRAY['DSP-2026-0001'])
  RETURNING id INTO p3;
  PERFORM fn_post_warehouse_payment(p3);

  PERFORM tests.eq(fn_account_balance(wh1.account_id, 'USD'), 7500.0000, 'wh1 after saraf payment');
  PERFORM tests.eq(fn_account_balance(v_saraf.account_id, 'USD'), 2000.0000, 'saraf holds the money');

  -- saraf releases $1,500 cash to the drawer
  PERFORM fn_post_saraf_cash_release(v_saraf.id, 'USD', 1500.0000, DATE '2026-07-17', 'HW-88991');
  PERFORM tests.eq(fn_account_balance(v_saraf.account_id, 'USD'), 500.0000, 'saraf after cash release');
  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE code = '1001'), 'USD'),
                   -10000.0000 + 1500.0000, 'USD drawer after saraf release');

  ------------------------------------------------------------------
  -- Aging (as of 2026-07-20: everything is 0–7 days old)
  ------------------------------------------------------------------
  SELECT * INTO v_age FROM fn_receivables_aging(DATE '2026-07-20')
   WHERE warehouse_id = wh1.id AND currency = 'USD';
  PERFORM tests.eq(v_age.total, 7500.0000, 'aging total for wh1');
  PERFORM tests.eq(v_age.bucket_0_7, 7500.0000, 'aging bucket 0-7');

  PERFORM tests.logout();

  ------------------------------------------------------------------
  -- Keeper portal: confirmation, pickups, isolation
  ------------------------------------------------------------------
  PERFORM tests.login(keeper1);

  -- sees only own dispatches / payments / stock
  SELECT count(*) INTO v_cnt FROM dispatch_invoices;
  PERFORM tests.eq(v_cnt, 1, 'keeper1 sees only wh1 dispatches');
  SELECT count(*) INTO v_cnt FROM warehouse_payments;
  PERFORM tests.eq(v_cnt, 2, 'keeper1 sees only wh1 payments');
  SELECT count(*) INTO v_cnt FROM stock_movements WHERE warehouse_id IS NULL;
  PERFORM tests.eq(v_cnt, 0, 'keeper1 cannot see central stock movements');

  -- confirms goods arrival
  PERFORM fn_confirm_dispatch(d1);
  PERFORM tests.ok((SELECT wh_confirmed_at FROM dispatch_invoices WHERE id = d1) IS NOT NULL,
    'keeper confirmed dispatch');
  PERFORM tests.throws(format('SELECT fn_confirm_dispatch(%L)', d1), '%already confirmed%');
  PERFORM tests.throws(format('SELECT fn_confirm_dispatch(%L)', d2), '%not authorized%');

  -- buyer pickup reduces custody stock
  v_pick := fn_record_pickup(wh1.id, v_variant, 200, 'Haji Waheed Market', 'DSP-2026-0001');
  PERFORM tests.eq((SELECT qty FROM v_stock_levels WHERE variant_id = v_variant AND warehouse_id = wh1.id),
                   800, 'wh1 stock after pickup');
  PERFORM tests.throws(format('SELECT fn_record_pickup(%L, %L, 5000, ''Nobody'')', wh1.id, v_variant),
    '%insufficient stock%');
  PERFORM tests.throws(format('SELECT fn_record_pickup(%L, %L, 10, ''Wrong Warehouse'')', wh2.id, v_variant),
    '%not authorized%');

  -- keeper cannot post dispatches or payments
  PERFORM tests.throws(format('SELECT fn_post_dispatch(%L)', d1), '%not authorized%');
  PERFORM tests.logout();

  -- keeper2 cannot read wh1's pickup records
  PERFORM tests.login(keeper2);
  SELECT count(*) INTO v_cnt FROM warehouse_pickups;
  PERFORM tests.eq(v_cnt, 0, 'keeper2 sees no wh1 pickups');
  PERFORM tests.logout();

  -- ledger statement access control: keeper1 may read only their own account
  PERFORM tests.login(keeper1);
  SELECT count(*) INTO v_cnt
    FROM fn_ledger_statement(wh1.account_id, 'USD', DATE '2026-07-01', DATE '2026-07-31');
  PERFORM tests.ok(v_cnt >= 4, 'keeper reads own money ledger');
  PERFORM tests.throws(format(
    'SELECT count(*) FROM fn_ledger_statement(%L, ''AFN'', DATE ''2026-07-01'', DATE ''2026-07-31'')',
    wh2.account_id), '%not authorized%');
  PERFORM tests.logout();

  ------------------------------------------------------------------
  -- pickups immutable
  ------------------------------------------------------------------
  PERFORM tests.throws('UPDATE warehouse_pickups SET qty = 1', '%immutable%');
END
$t$;
