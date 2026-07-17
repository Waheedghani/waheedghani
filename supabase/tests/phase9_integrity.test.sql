-- ============================================================================
-- Phase 9 tests: health checks HC-01..HC-12 (clean run = all ok; deliberately
-- corrupted fixtures = detected), reconciliation module.
-- ============================================================================

DO $t$
DECLARE
  admin_id  uuid := md5('test-user:admin1')::uuid;
  office_id uuid := md5('test-user:office1')::uuid;
  v_run  uuid;
  v_cnt  int;
  v_line uuid;
  v_orig numeric;
  v_sm   uuid;
  v_rec  uuid;
  v_saraf sarafs%ROWTYPE;
  wh1    warehouses%ROWTYPE;
  wh2    warehouses%ROWTYPE;
  v_variant uuid;
BEGIN
  SELECT * INTO v_saraf FROM sarafs WHERE name = 'Saraf Ahmadi';
  SELECT * INTO wh1 FROM warehouses WHERE name = 'Sarai Kabul North';
  SELECT * INTO wh2 FROM warehouses WHERE name = 'Sarai Jalalabad';
  SELECT id INTO v_variant FROM product_variants WHERE label = '16L Bottle';

  ------------------------------------------------------------------
  -- Clean data: every check is green
  ------------------------------------------------------------------
  PERFORM tests.login(admin_id);
  v_run := fn_run_health_checks();
  PERFORM tests.logout();

  SELECT count(*) INTO v_cnt FROM data_health_results WHERE run_id = v_run;
  PERFORM tests.eq(v_cnt, 12, 'twelve checks executed');
  SELECT count(*) INTO v_cnt FROM data_health_results WHERE run_id = v_run AND severity = 'ok';
  PERFORM tests.eq(v_cnt, 12, 'all checks green on clean data');

  -- office cannot run them
  PERFORM tests.login(office_id);
  PERFORM tests.throws('SELECT fn_run_health_checks()', '%only an admin%');
  PERFORM tests.logout();

  ------------------------------------------------------------------
  -- Corruption 1: unbalance a posted entry behind the triggers' back
  ------------------------------------------------------------------
  ALTER TABLE journal_lines DISABLE TRIGGER USER;
  SELECT id, debit INTO v_line, v_orig FROM journal_lines
   WHERE debit > 0 ORDER BY debit DESC LIMIT 1;
  UPDATE journal_lines SET debit = debit + 0.0100 WHERE id = v_line;
  ALTER TABLE journal_lines ENABLE TRIGGER USER;

  v_run := fn_run_health_checks();
  PERFORM tests.ok(EXISTS (SELECT 1 FROM data_health_results
    WHERE run_id = v_run AND check_code = 'HC-01' AND severity = 'critical'),
    'HC-01 detects the unbalanced entry');

  ALTER TABLE journal_lines DISABLE TRIGGER USER;
  UPDATE journal_lines SET debit = v_orig WHERE id = v_line;
  ALTER TABLE journal_lines ENABLE TRIGGER USER;

  ------------------------------------------------------------------
  -- Corruption 2: negative stock
  ------------------------------------------------------------------
  INSERT INTO stock_movements (movement_date, variant_id, warehouse_id, movement_type, qty, notes)
  VALUES (CURRENT_DATE, v_variant, NULL, 'adjustment', -999999, 'corruption fixture')
  RETURNING id INTO v_sm;

  v_run := fn_run_health_checks();
  PERFORM tests.ok(EXISTS (SELECT 1 FROM data_health_results
    WHERE run_id = v_run AND check_code = 'HC-03' AND severity = 'critical'),
    'HC-03 detects negative stock');
  PERFORM tests.ok(EXISTS (SELECT 1 FROM data_health_results
    WHERE run_id = v_run AND check_code = 'HC-09' AND severity = 'critical'),
    'HC-09 detects the retroactive over-issue');

  ALTER TABLE stock_movements DISABLE TRIGGER USER;
  DELETE FROM stock_movements WHERE id = v_sm;
  ALTER TABLE stock_movements ENABLE TRIGGER USER;

  -- back to green
  v_run := fn_run_health_checks();
  SELECT count(*) INTO v_cnt FROM data_health_results WHERE run_id = v_run AND severity = 'ok';
  PERFORM tests.eq(v_cnt, 12, 'checks green again after repair');

  ------------------------------------------------------------------
  -- Money reconciliation: zero variance resolves without adjustment
  ------------------------------------------------------------------
  PERFORM tests.login(office_id);
  v_rec := fn_reconcile_money('saraf', v_saraf.id, DATE '2026-07-31', 103000.0000, 500.0000);
  PERFORM tests.eq((SELECT (variance ->> 'AFN')::numeric FROM reconciliations WHERE id = v_rec),
                   0, 'saraf AFN variance zero');
  PERFORM tests.eq((SELECT (variance ->> 'USD')::numeric FROM reconciliations WHERE id = v_rec),
                   0, 'saraf USD variance zero');
  -- office may create but not resolve
  PERFORM tests.throws(format('SELECT fn_resolve_money_reconciliation(%L, ''ok'')', v_rec),
    '%only an admin%');
  PERFORM tests.logout();

  PERFORM tests.login(admin_id);
  PERFORM fn_resolve_money_reconciliation(v_rec, 'Statement matches system');
  PERFORM tests.ok((SELECT status FROM reconciliations WHERE id = v_rec) = 'resolved', 'reconciliation resolved');
  PERFORM tests.throws(format('SELECT fn_resolve_money_reconciliation(%L, ''again'')', v_rec),
    '%already resolved%');
  PERFORM tests.logout();

  ------------------------------------------------------------------
  -- Money reconciliation with variance + documented adjustment
  -- wh2 system balance ؋265,000; keeper states ؋264,000
  ------------------------------------------------------------------
  PERFORM tests.login(office_id);
  v_rec := fn_reconcile_money('warehouse_money', wh2.id, DATE '2026-07-31', 264000.0000, 0);
  PERFORM tests.eq((SELECT (variance ->> 'AFN')::numeric FROM reconciliations WHERE id = v_rec),
                   -1000.0000, 'wh2 variance detected');
  PERFORM tests.logout();

  PERFORM tests.login(admin_id);
  PERFORM fn_resolve_money_reconciliation(v_rec, 'Keeper bill 44 was cancelled on paper only', true);
  PERFORM tests.eq(fn_account_balance(wh2.account_id, 'AFN'), 264000.0000,
    'wh2 balance adjusted to stated amount');
  PERFORM tests.ok((SELECT adjustment_entry_id FROM reconciliations WHERE id = v_rec) IS NOT NULL,
    'adjustment entry linked');
  PERFORM tests.logout();

  ------------------------------------------------------------------
  -- Warehouse stock count: custody-only adjustment (no journal)
  -- wh1 16L system 800, counted 795
  ------------------------------------------------------------------
  PERFORM tests.login(office_id);
  v_rec := fn_reconcile_warehouse_stock(wh1.id,
    jsonb_build_array(jsonb_build_object('variant_id', v_variant, 'counted', 795)));
  PERFORM tests.logout();

  PERFORM tests.login(admin_id);
  PERFORM fn_resolve_stock_reconciliation(v_rec, '5 bottles broken in warehouse handling');
  PERFORM tests.eq((SELECT qty FROM v_stock_levels WHERE variant_id = v_variant AND warehouse_id = wh1.id),
                   795, 'wh1 custody stock corrected');
  PERFORM tests.ok((SELECT adjustment_entry_id FROM reconciliations WHERE id = v_rec) IS NULL,
    'custody adjustment carries no journal entry');

  ------------------------------------------------------------------
  -- Central stock count: valued at pool average cost (journal posted)
  -- central 16L system 1,932, counted 1,930 → 2 @ 13.069212 = 26.1384
  ------------------------------------------------------------------
  v_rec := fn_reconcile_warehouse_stock(NULL,
    jsonb_build_array(jsonb_build_object('variant_id', v_variant, 'counted', 1930)));
  PERFORM fn_resolve_stock_reconciliation(v_rec, '2 bottles damaged in the yard');
  PERFORM tests.eq((SELECT qty FROM v_stock_levels WHERE variant_id = v_variant AND warehouse_id IS NULL),
                   1930, 'central stock corrected');
  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE code = '1200'), 'USD'),
                   25249.7179 - 26.1384, 'inventory written down at average cost');
  PERFORM tests.ok((SELECT adjustment_entry_id FROM reconciliations WHERE id = v_rec) IS NOT NULL,
    'central adjustment posted a journal entry');
  PERFORM tests.logout();
END
$t$;
