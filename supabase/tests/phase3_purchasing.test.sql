-- ============================================================================
-- Phase 3 tests: purchase invoice draft->post, advance & bank settlement,
-- exact ledger balances, immutability, RLS.
-- ============================================================================

DO $t$
DECLARE
  office_id uuid := md5('test-user:office1')::uuid;
  wh_user   uuid := md5('test-user:keeper1')::uuid;
  v_sup     suppliers%ROWTYPE;
  v_variant uuid;
  v_inv     uuid;
  v_inv2    uuid;
  v_pay     uuid;
  v_settle  uuid;
  v_transit uuid;
  v_bank    uuid;
  v_doc     text;
  v_cnt     int;
  v_total   numeric;
BEGIN
  SELECT * INTO v_sup FROM suppliers WHERE name = 'Golden Palm Sdn Bhd';
  SELECT id INTO v_variant FROM product_variants WHERE label = '16L Bottle';
  PERFORM tests.ok(v_sup.id IS NOT NULL AND v_variant IS NOT NULL, 'fixtures present');

  ------------------------------------------------------------------
  -- Draft invoice: 3 containers x 1150 bottles x $12.7350
  ------------------------------------------------------------------
  PERFORM tests.login(office_id);

  INSERT INTO purchase_invoices
    (invoice_date, supplier_id, invoice_number_supplier, bill_of_lading,
     bank_name, currency, advance_payment, bank_balance_due)
  VALUES
    (DATE '2026-07-01', v_sup.id, 'GP-88112', 'BL-MY-4471',
     'Maybank', 'USD', 10000.0000, 33935.7500)
  RETURNING id INTO v_inv;

  INSERT INTO purchase_invoice_lines
    (invoice_id, variant_id, containers_count, units_per_container, price_per_unit, container_numbers)
  VALUES
    (v_inv, v_variant, 3, 1150, 12.7350, ARRAY['MSKU-771001', 'MSKU-771002', 'MSKU-771003']);

  SELECT line_total INTO v_total FROM purchase_invoice_lines WHERE invoice_id = v_inv;
  PERFORM tests.eq(v_total, 43935.7500, 'generated line total exact to 4 dp');

  -- duplicate container numbers on one line rejected
  PERFORM tests.throws(format(
    'INSERT INTO purchase_invoice_lines (invoice_id, variant_id, containers_count, units_per_container, price_per_unit, container_numbers)
     VALUES (%L, %L, 1, 10, 1, ARRAY[''X1'',''X1''])', v_inv, v_variant),
    '%duplicate container numbers%');

  ------------------------------------------------------------------
  -- Post: journal, doc number, transit account
  ------------------------------------------------------------------
  PERFORM fn_post_purchase_invoice(v_inv);

  SELECT doc_no, transit_account_id INTO v_doc, v_transit FROM purchase_invoices WHERE id = v_inv;
  PERFORM tests.ok(v_doc = 'PI-2026-0001', 'doc no assigned at post, got ' || v_doc);
  PERFORM tests.eq(fn_account_balance(v_transit, 'USD'), 43935.7500, 'goods in transit debit');
  PERFORM tests.eq(fn_account_balance(v_sup.account_id, 'USD'), -43935.7500, 'supplier payable credit');

  -- cannot post twice
  PERFORM tests.throws(format('SELECT fn_post_purchase_invoice(%L)', v_inv), '%only draft%');

  -- layer 1 (RLS): posted rows are invisible to office UPDATE/DELETE
  UPDATE purchase_invoices SET notes = 'x' WHERE id = v_inv;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  PERFORM tests.eq(v_cnt, 0, 'RLS: office cannot update a posted invoice');
  DELETE FROM purchase_invoices WHERE id = v_inv;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  PERFORM tests.eq(v_cnt, 0, 'RLS: office cannot delete a posted invoice');
  -- (the freeze trigger fires before RLS WITH CHECK; either layer denies)
  PERFORM tests.throws(format(
    'INSERT INTO purchase_invoice_lines (invoice_id, variant_id, containers_count, units_per_container, price_per_unit)
     VALUES (%L, %L, 1, 10, 1)', v_inv, v_variant), '%immutable%');

  ------------------------------------------------------------------
  -- advance + bank due must equal total
  ------------------------------------------------------------------
  INSERT INTO purchase_invoices (invoice_date, supplier_id, currency, advance_payment, bank_balance_due)
  VALUES (DATE '2026-07-02', v_sup.id, 'USD', 5000, 5000)
  RETURNING id INTO v_inv2;
  INSERT INTO purchase_invoice_lines (invoice_id, variant_id, containers_count, units_per_container, price_per_unit)
  VALUES (v_inv2, v_variant, 1, 1150, 10.0000); -- total 11,500 <> 10,000
  PERFORM tests.throws(format('SELECT fn_post_purchase_invoice(%L)', v_inv2), '%must equal invoice total%');
  DELETE FROM purchase_invoices WHERE id = v_inv2; -- drafts may be deleted

  ------------------------------------------------------------------
  -- Advance payment: cash USD 10,000
  ------------------------------------------------------------------
  INSERT INTO supplier_payments (payment_date, supplier_id, purchase_invoice_id, kind, method, currency, amount)
  VALUES (DATE '2026-07-01', v_sup.id, v_inv, 'advance', 'cash', 'USD', 10000.0000)
  RETURNING id INTO v_pay;
  PERFORM fn_post_supplier_payment(v_pay);

  PERFORM tests.eq(fn_account_balance(v_sup.account_id, 'USD'), -33935.7500, 'payable after advance');
  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE code = '1001'), 'USD'),
                   -10000.0000, 'USD drawer credited by advance');

  ------------------------------------------------------------------
  -- Bank settlement of the remainder through Maybank
  ------------------------------------------------------------------
  INSERT INTO supplier_payments (payment_date, supplier_id, purchase_invoice_id, kind, method, bank_name, currency, amount)
  VALUES (DATE '2026-07-10', v_sup.id, v_inv, 'settlement', 'bank', 'Maybank', 'USD', 33935.7500)
  RETURNING id INTO v_settle;
  PERFORM fn_post_supplier_payment(v_settle);

  SELECT id INTO v_bank FROM accounts WHERE type = 'bank' AND name = 'Maybank';
  PERFORM tests.ok(v_bank IS NOT NULL, 'bank account auto-created');
  PERFORM tests.eq(fn_account_balance(v_sup.account_id, 'USD'), 0, 'supplier fully settled');
  PERFORM tests.eq(fn_account_balance(v_bank, 'USD'), -33935.7500, 'bank credited');

  ------------------------------------------------------------------
  -- Ledger statement: opening + rows + running balance
  ------------------------------------------------------------------
  SELECT count(*) INTO v_cnt
    FROM fn_ledger_statement(v_sup.account_id, 'USD', DATE '2026-07-01', DATE '2026-07-31');
  PERFORM tests.eq(v_cnt, 4, 'statement rows: opening + invoice + 2 payments');
  PERFORM tests.eq(
    (SELECT running_balance FROM fn_ledger_statement(v_sup.account_id, 'USD', DATE '2026-07-01', DATE '2026-07-31')
      ORDER BY entry_date DESC, entry_no DESC NULLS LAST LIMIT 1),
    0, 'statement closes at zero');

  PERFORM tests.logout();

  ------------------------------------------------------------------
  -- layer 2 (trigger): even bypassing RLS entirely (superuser), posted
  -- documents are frozen by fn_doc_immutable / fn_child_lines_frozen
  ------------------------------------------------------------------
  PERFORM tests.throws(format('UPDATE purchase_invoices SET notes = ''x'' WHERE id = %L', v_inv), '%immutable%');
  PERFORM tests.throws(format('DELETE FROM purchase_invoices WHERE id = %L', v_inv), '%cannot be deleted%');
  PERFORM tests.throws(format(
    'INSERT INTO purchase_invoice_lines (invoice_id, variant_id, containers_count, units_per_container, price_per_unit)
     VALUES (%L, %L, 1, 10, 1)', v_inv, v_variant), '%immutable%');
  PERFORM tests.throws(format('DELETE FROM purchase_invoice_lines WHERE invoice_id = %L', v_inv), '%immutable%');

  ------------------------------------------------------------------
  -- RLS: warehouse user sees nothing in purchasing
  ------------------------------------------------------------------
  PERFORM tests.login(wh_user);
  SELECT count(*) INTO v_cnt FROM purchase_invoices;
  PERFORM tests.eq(v_cnt, 0, 'warehouse user sees no purchase invoices');
  PERFORM tests.throws(format('SELECT fn_post_purchase_invoice(%L)', v_inv), '%not authorized%');
  PERFORM tests.logout();
END
$t$;
