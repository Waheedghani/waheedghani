-- ============================================================================
-- Phase 8 tests: office expenses — categories, cash/saraf payment routes,
-- closed-day guard, RLS.
-- ============================================================================

DO $t$
DECLARE
  office_id uuid := md5('test-user:office1')::uuid;
  v_saraf   sarafs%ROWTYPE;
  v_cat_rent uuid;
  v_cat_util uuid;
  v_exp     uuid;
  v_cnt     int;
BEGIN
  SELECT * INTO v_saraf FROM sarafs WHERE name = 'Saraf Ahmadi';
  SELECT id INTO v_cat_rent FROM expense_categories WHERE name = 'Rent';
  SELECT id INTO v_cat_util FROM expense_categories WHERE name = 'Utilities';
  PERFORM tests.ok(v_cat_rent IS NOT NULL AND v_cat_util IS NOT NULL, 'seeded categories present');

  PERFORM tests.login(office_id);

  ------------------------------------------------------------------
  -- Cash expense: rent ؋30,000 on 07-19
  ------------------------------------------------------------------
  INSERT INTO office_expenses (expense_date, category_id, description, currency, amount, paid_via)
  VALUES (DATE '2026-07-19', v_cat_rent, 'Office rent July', 'AFN', 30000.0000, 'cash')
  RETURNING id INTO v_exp;
  PERFORM fn_post_office_expense(v_exp);

  PERFORM tests.ok((SELECT doc_no FROM office_expenses WHERE id = v_exp) = 'EXP-2026-0001', 'expense doc no');
  PERFORM tests.eq(fn_account_balance((SELECT account_id FROM expense_categories WHERE id = v_cat_rent), 'AFN'),
                   30000.0000, 'rent expense account debited');
  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE code = '1000'), 'AFN'),
                   579875.5000 - 30000.0000, 'drawer after cash expense');

  ------------------------------------------------------------------
  -- Saraf-paid expense: utilities ؋7,000 — hits saraf ledger, NOT drawer
  ------------------------------------------------------------------
  INSERT INTO office_expenses (expense_date, category_id, description, currency, amount, paid_via, saraf_id)
  VALUES (DATE '2026-07-19', v_cat_util, 'Electricity bill', 'AFN', 7000.0000, 'saraf', v_saraf.id)
  RETURNING id INTO v_exp;
  PERFORM fn_post_office_expense(v_exp);

  PERFORM tests.eq(fn_account_balance(v_saraf.account_id, 'AFN'), 110000.0000 - 7000.0000,
                   'saraf ledger after saraf-paid expense');
  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE code = '1000'), 'AFN'),
                   549875.5000, 'drawer untouched by saraf-paid expense');
  PERFORM tests.ok(EXISTS (
      SELECT 1 FROM saraf_transactions
       WHERE linked_source_type = 'office_expense' AND linked_source_id = v_exp),
    'saraf-paid expense registered in hawala book');

  ------------------------------------------------------------------
  -- Cash expense dated into the closed day (07-18) is blocked
  ------------------------------------------------------------------
  INSERT INTO office_expenses (expense_date, category_id, description, currency, amount, paid_via)
  VALUES (DATE '2026-07-18', v_cat_rent, 'Backdated rent', 'AFN', 100, 'cash')
  RETURNING id INTO v_exp;
  PERFORM tests.throws(format('SELECT fn_post_office_expense(%L)', v_exp),
    '%closed — no cash postings%');
  DELETE FROM office_expenses WHERE id = v_exp;

  ------------------------------------------------------------------
  -- Constraint: saraf method requires a saraf
  ------------------------------------------------------------------
  PERFORM tests.throws(format(
    'INSERT INTO office_expenses (expense_date, category_id, description, currency, amount, paid_via)
     VALUES (CURRENT_DATE, %L, ''x'', ''AFN'', 10, ''saraf'')', v_cat_rent),
    '%oex_saraf_needs_saraf%');

  PERFORM tests.logout();

  ------------------------------------------------------------------
  -- RLS: keeper sees nothing
  ------------------------------------------------------------------
  PERFORM tests.login(md5('test-user:keeper1')::uuid);
  SELECT count(*) INTO v_cnt FROM office_expenses;
  PERFORM tests.eq(v_cnt, 0, 'keeper sees no office expenses');
  SELECT count(*) INTO v_cnt FROM expense_categories;
  PERFORM tests.eq(v_cnt, 0, 'keeper sees no expense categories');
  PERFORM tests.logout();
END
$t$;
