-- ============================================================================
-- Phase 6 tests: saraf transactions — deposits, cash releases, automatic
-- hawala registration of warehouse payments, linked-row protection, RLS.
-- ============================================================================

DO $t$
DECLARE
  office_id uuid := md5('test-user:office1')::uuid;
  keeper1   uuid := md5('test-user:keeper1')::uuid;
  v_saraf   sarafs%ROWTYPE;
  wh2       warehouses%ROWTYPE;
  v_txn     uuid;
  v_pay     uuid;
  v_cnt     int;
BEGIN
  SELECT * INTO v_saraf FROM sarafs WHERE name = 'Saraf Ahmadi';
  SELECT * INTO wh2 FROM warehouses WHERE name = 'Sarai Jalalabad';

  PERFORM tests.login(office_id);

  ------------------------------------------------------------------
  -- Deposit ؋100,000 into the saraf (drawer -> saraf)
  ------------------------------------------------------------------
  INSERT INTO saraf_transactions (txn_date, saraf_id, direction, currency, amount, hawala_number, description)
  VALUES (DATE '2026-07-16', v_saraf.id, 'in', 'AFN', 100000.0000, 'HW-55001', 'Deposit for transfers')
  RETURNING id INTO v_txn;
  PERFORM fn_post_saraf_transaction(v_txn);

  PERFORM tests.eq(fn_account_balance(v_saraf.account_id, 'AFN'), 100000.0000, 'saraf holds the deposit');
  PERFORM tests.ok((SELECT doc_no FROM saraf_transactions WHERE id = v_txn) LIKE 'SRT-2026-%',
    'saraf txn numbered at post');

  ------------------------------------------------------------------
  -- Saraf releases ؋40,000 back to the drawer
  ------------------------------------------------------------------
  PERFORM fn_post_saraf_cash_release(v_saraf.id, 'AFN', 40000.0000, DATE '2026-07-17', 'HW-55002');
  PERFORM tests.eq(fn_account_balance(v_saraf.account_id, 'AFN'), 60000.0000, 'saraf after release');
  PERFORM tests.ok(EXISTS (
      SELECT 1 FROM saraf_transactions
       WHERE saraf_id = v_saraf.id AND direction = 'out' AND amount = 40000.0000 AND status = 'posted'),
    'release registered in the hawala book');

  ------------------------------------------------------------------
  -- Warehouse payment via saraf auto-registers a linked hawala record
  ------------------------------------------------------------------
  INSERT INTO warehouse_payments (payment_date, warehouse_id, currency, amount, method, saraf_id, hawala_number, bill_refs)
  VALUES (DATE '2026-07-19', wh2.id, 'AFN', 50000.0000, 'saraf', v_saraf.id, 'HW-55003', ARRAY['DSP-2026-0002'])
  RETURNING id INTO v_pay;
  PERFORM fn_post_warehouse_payment(v_pay);

  PERFORM tests.eq(fn_account_balance(v_saraf.account_id, 'AFN'), 110000.0000, 'saraf after wh payment');
  PERFORM tests.eq(fn_account_balance(wh2.account_id, 'AFN'), 265000.0000, 'wh2 receivable reduced');
  PERFORM tests.ok(EXISTS (
      SELECT 1 FROM saraf_transactions
       WHERE linked_source_type = 'warehouse_payment' AND linked_source_id = v_pay
         AND hawala_number = 'HW-55003' AND status = 'posted'),
    'linked hawala record created automatically');

  ------------------------------------------------------------------
  -- Linked rows cannot be posted independently
  ------------------------------------------------------------------
  INSERT INTO saraf_transactions (txn_date, saraf_id, direction, currency, amount, description,
                                  linked_source_type, linked_source_id)
  VALUES (DATE '2026-07-19', v_saraf.id, 'in', 'AFN', 1, 'bogus link', 'warehouse_payment', v_pay)
  RETURNING id INTO v_txn;
  PERFORM tests.throws(format('SELECT fn_post_saraf_transaction(%L)', v_txn),
    '%linked saraf records%');
  DELETE FROM saraf_transactions WHERE id = v_txn;

  -- saraf statement via the generic ledger function
  SELECT count(*) INTO v_cnt
    FROM fn_ledger_statement(v_saraf.account_id, 'AFN', DATE '2026-07-01', DATE '2026-07-31');
  PERFORM tests.ok(v_cnt >= 4, 'saraf statement rows');

  PERFORM tests.logout();

  ------------------------------------------------------------------
  -- RLS: warehouse keeper sees no saraf data
  ------------------------------------------------------------------
  PERFORM tests.login(keeper1);
  SELECT count(*) INTO v_cnt FROM saraf_transactions;
  PERFORM tests.eq(v_cnt, 0, 'keeper sees no saraf transactions');
  PERFORM tests.throws(format('SELECT fn_post_saraf_cash_release(%L, ''AFN'', 10)', v_saraf.id),
    '%not authorized%');
  PERFORM tests.logout();
END
$t$;
