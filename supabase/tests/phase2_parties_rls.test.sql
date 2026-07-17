-- ============================================================================
-- Phase 2 tests: party CRUD auto-creates ledger accounts; RLS isolation —
-- a warehouse user can only ever see their own warehouse; office sees all.
-- ============================================================================

DO $t$
DECLARE
  office_id uuid;
  wh1_user  uuid;
  wh2_user  uuid;
  sup_id    uuid;
  wh1_id    uuid;
  wh2_id    uuid;
  saraf_id  uuid;
  v_code    text;
  v_cnt     int;
BEGIN
  ------------------------------------------------------------------
  -- Office user creates parties; ledger accounts appear automatically
  ------------------------------------------------------------------
  office_id := tests.mk_user('office1', 'office1@test.local');
  INSERT INTO app_users (id, full_name, role) VALUES (office_id, 'Office One', 'office')
  ON CONFLICT (id) DO NOTHING;
  PERFORM tests.login(office_id);

  INSERT INTO suppliers (name, name_ps, contact, phone)
  VALUES ('Golden Palm Sdn Bhd', 'ګولډن پام', 'Mr. Lee', '+60-123')
  RETURNING id INTO sup_id;
  SELECT a.code INTO v_code FROM suppliers s JOIN accounts a ON a.id = s.account_id WHERE s.id = sup_id;
  PERFORM tests.ok(v_code = '2000-0001', 'supplier payable account auto-created, got ' || coalesce(v_code, 'NULL'));

  INSERT INTO warehouses (name, name_ps, keeper_name)
  VALUES ('Sarai Kabul North', 'سرای شمال کابل', 'Haji Karim')
  RETURNING id INTO wh1_id;
  INSERT INTO warehouses (name, name_ps, keeper_name)
  VALUES ('Sarai Jalalabad', 'سرای جلال اباد', 'Haji Naeem')
  RETURNING id INTO wh2_id;
  SELECT a.code INTO v_code FROM warehouses w JOIN accounts a ON a.id = w.account_id WHERE w.id = wh1_id;
  PERFORM tests.ok(v_code = '1400-0001', 'warehouse receivable account auto-created, got ' || coalesce(v_code, 'NULL'));
  SELECT a.code INTO v_code FROM warehouses w JOIN accounts a ON a.id = w.account_id WHERE w.id = wh2_id;
  PERFORM tests.ok(v_code = '1400-0002', 'second warehouse got next code, got ' || coalesce(v_code, 'NULL'));

  INSERT INTO sarafs (name, name_ps, phone)
  VALUES ('Saraf Ahmadi', 'صرافي احمدي', '+93-700')
  RETURNING id INTO saraf_id;
  SELECT a.code INTO v_code FROM sarafs s JOIN accounts a ON a.id = s.account_id WHERE s.id = saraf_id;
  PERFORM tests.ok(v_code = '1500-0001', 'saraf account auto-created, got ' || coalesce(v_code, 'NULL'));

  -- duplicate party name is rejected
  PERFORM tests.throws(
    'INSERT INTO suppliers (name) VALUES (''golden palm sdn bhd'')', '%duplicate key%');

  PERFORM tests.logout();

  ------------------------------------------------------------------
  -- Warehouse users: bound to their own سرای
  ------------------------------------------------------------------
  wh1_user := tests.mk_user('keeper1', 'keeper1@test.local');
  wh2_user := tests.mk_user('keeper2', 'keeper2@test.local');
  INSERT INTO app_users (id, full_name, role, warehouse_id) VALUES
    (wh1_user, 'Keeper One', 'warehouse', wh1_id),
    (wh2_user, 'Keeper Two', 'warehouse', wh2_id)
  ON CONFLICT (id) DO NOTHING;

  -- keeper1 sees exactly one warehouse: their own
  PERFORM tests.login(wh1_user);
  SELECT count(*) INTO v_cnt FROM warehouses;
  PERFORM tests.eq(v_cnt, 1, 'warehouse user sees exactly 1 warehouse');
  PERFORM tests.ok(EXISTS (SELECT 1 FROM warehouses WHERE id = wh1_id), 'and it is their own');
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM warehouses WHERE id = wh2_id), 'cannot see the other sarai');

  -- no access to suppliers, sarafs, accounts, journals
  SELECT count(*) INTO v_cnt FROM suppliers;
  PERFORM tests.eq(v_cnt, 0, 'warehouse user sees no suppliers');
  SELECT count(*) INTO v_cnt FROM sarafs;
  PERFORM tests.eq(v_cnt, 0, 'warehouse user sees no sarafs');
  SELECT count(*) INTO v_cnt FROM accounts;
  PERFORM tests.eq(v_cnt, 0, 'warehouse user sees no ledger accounts');
  SELECT count(*) INTO v_cnt FROM journal_entries;
  PERFORM tests.eq(v_cnt, 0, 'warehouse user sees no journal entries');

  -- cannot create or modify master data
  PERFORM tests.throws('INSERT INTO suppliers (name) VALUES (''Sneaky Co'')', '%row-level security%');
  -- RLS filters the row out of UPDATE entirely: zero rows affected
  UPDATE warehouses SET name = 'Mine Now' WHERE id = wh1_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  PERFORM tests.eq(v_cnt, 0, 'warehouse user cannot update warehouse rows');
  PERFORM tests.logout();

  -- products remain readable to warehouse users (labels for stock screens)
  PERFORM tests.login(wh1_user);
  SELECT count(*) INTO v_cnt FROM product_variants;
  PERFORM tests.ok(v_cnt >= 6, 'warehouse user can read product variants');
  PERFORM tests.logout();

  ------------------------------------------------------------------
  -- Office sees everything
  ------------------------------------------------------------------
  PERFORM tests.login(office_id);
  SELECT count(*) INTO v_cnt FROM warehouses;
  PERFORM tests.eq(v_cnt, 2, 'office sees all warehouses');
  PERFORM tests.logout();
END
$t$;
