-- ============================================================================
-- SARAI ERP — Seed data (idempotent; safe to run repeatedly)
-- Chart of accounts, products & variants, expense categories.
-- NOTE ON ADMIN USER: app_users.id references auth.users. The first real user
-- signs up through the app and calls fn_bootstrap_admin('Full Name') once —
-- that user becomes the admin. (Seeding a fake auth user into a production
-- auth schema is not acceptable; the SQL test harness creates its own users.)
-- All Pashto strings: DRAFT-PS — client will verify final wording.
-- ============================================================================

INSERT INTO accounts (code, name, name_ps, type, fixed_currency) VALUES
  ('1000', 'Cash Drawer AFN',            'دخل — افغانۍ',            'cash',           'AFN'),
  ('1001', 'Cash Drawer USD',            'دخل — ډالر',              'cash',           'USD'),
  ('1200', 'Inventory — Oil',            'ذخیره — د پخلي غوړي',     'inventory',      NULL),
  ('1210', 'Inventory — Sugar',          'ذخیره — بوره',            'inventory',      NULL),
  ('3000', 'Opening Balances / Equity',  'پرانیستي بیلانسونه',      'equity',         NULL),
  ('3900', 'FX Conversion Clearing',     'د اسعارو د تبادلې حساب',  'fx_clearing',    NULL),
  ('4000', 'Sales Revenue — Oil',        'د پلور عاید — غوړي',      'revenue',        NULL),
  ('4010', 'Sales Revenue — Sugar',      'د پلور عاید — بوره',      'revenue',        NULL),
  ('5000', 'Cost of Goods Sold — Oil',   'د پلورل شویو توکو بیه — غوړي', 'cogs',      NULL),
  ('5010', 'Cost of Goods Sold — Sugar', 'د پلورل شویو توکو بیه — بوره', 'cogs',      NULL),
  ('5100', 'Import Expense — Shipping',  'د وارداتو لګښت — بار وړنه',   'import_expense', NULL),
  ('5110', 'Import Expense — Surcharge', 'د وارداتو لګښت — اضافي فیس',  'import_expense', NULL),
  ('5120', 'Import Expense — Customs',   'د وارداتو لګښت — ګمرک',       'import_expense', NULL),
  ('5130', 'Import Expense — Transport', 'د وارداتو لګښت — ټرانسپورټ',  'import_expense', NULL),
  ('5140', 'Import Expense — Other',     'د وارداتو لګښت — نور',        'import_expense', NULL),
  ('5190', 'Import Expenses Capitalized (contra)', 'د وارداتو لګښت — سرمایه شوی', 'import_expense', NULL),
  ('5200', 'Waste / Loss in Transit',    'ضایعات په لار کې',        'waste_expense',  NULL),
  ('6000', 'Office — Rent',              'دفتر — کرایه',            'office_expense', NULL),
  ('6010', 'Office — Salaries',          'دفتر — معاشونه',          'office_expense', NULL),
  ('6020', 'Office — Utilities',         'دفتر — برېښنا او اوبه',   'office_expense', NULL),
  ('6090', 'Office — Other',             'دفتر — نور لګښتونه',      'office_expense', NULL)
ON CONFLICT (code) DO NOTHING;

-- Products & variants (guarded: tables appear in Phase 2)
DO $seed$
BEGIN
  IF to_regclass('public.products') IS NULL THEN RETURN; END IF;

  INSERT INTO products (code, name, name_ps, category) VALUES
    ('OIL', 'Cooking Oil', 'د پخلي غوړي', 'oil'),
    ('SUG', 'Sugar',       'بوره',        'sugar')
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO product_variants (product_id, label, label_ps, unit, size_value, kg_per_bag)
  SELECT p.id, v.label, v.label_ps, v.unit::product_unit, v.size_value, v.kg_per_bag
    FROM (VALUES
      ('OIL', '5L Bottle',  'بوشکه ۵ لیتره',  'bottle', 5::numeric,  NULL::numeric),
      ('OIL', '10L Bottle', 'بوشکه ۱۰ لیتره', 'bottle', 10, NULL),
      ('OIL', '16L Bottle', 'بوشکه ۱۶ لیتره', 'bottle', 16, NULL),
      ('OIL', '20L Bottle', 'بوشکه ۲۰ لیتره', 'bottle', 20, NULL),
      ('SUG', 'Sugar (KG)',  'بوره (کیلو)',    'kg',   NULL, NULL),
      ('SUG', 'Sugar (Bag)', 'بوره (بوجۍ)',    'bag',  NULL, 50)
    ) AS v(product_code, label, label_ps, unit, size_value, kg_per_bag)
    JOIN products p ON p.code = v.product_code
  ON CONFLICT (product_id, label) DO NOTHING;
END
$seed$;

-- Expense categories (guarded: table appears in Phase 8)
DO $seed$
BEGIN
  IF to_regclass('public.expense_categories') IS NULL THEN RETURN; END IF;

  INSERT INTO expense_categories (name, name_ps, account_id)
  SELECT v.name, v.name_ps, a.id
    FROM (VALUES
      ('Rent',      'کرایه',           '6000'),
      ('Salaries',  'معاشونه',         '6010'),
      ('Utilities', 'برېښنا او اوبه',  '6020'),
      ('Other',     'نور لګښتونه',     '6090')
    ) AS v(name, name_ps, account_code)
    JOIN accounts a ON a.code = v.account_code
   WHERE NOT EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.name = v.name);
END
$seed$;
