-- ============================================================================
-- Phase 1 tests: journal balance enforcement (per currency), immutability,
-- reversal, gapless entry numbers, single-currency accounts, audit.
-- Runs after phase0 tests (admin1 exists).
-- ============================================================================

DO $t$
DECLARE
  acc_afn  uuid;
  acc_usd  uuid;
  acc_eq   uuid;
  e1 uuid; e2 uuid; rev uuid;
  n1 bigint; n2 bigint;
  admin_id uuid;
  office_id uuid;
BEGIN
  SELECT id INTO acc_afn FROM accounts WHERE code = '1000';
  SELECT id INTO acc_usd FROM accounts WHERE code = '1001';
  SELECT id INTO acc_eq  FROM accounts WHERE code = '3000';
  PERFORM tests.ok(acc_afn IS NOT NULL AND acc_usd IS NOT NULL AND acc_eq IS NOT NULL,
    'seeded chart of accounts present');

  ------------------------------------------------------------------
  -- 1. A balanced entry posts; balances are exact NUMERIC
  ------------------------------------------------------------------
  e1 := fn_post_journal(DATE '2026-07-16', 'Opening cash AFN', '', 'test', NULL,
    jsonb_build_array(
      jsonb_build_object('account_id', acc_afn, 'currency', 'AFN', 'debit', '100000.5000', 'credit', 0),
      jsonb_build_object('account_id', acc_eq,  'currency', 'AFN', 'debit', 0, 'credit', '100000.5000')));
  PERFORM tests.eq(fn_account_balance(acc_afn, 'AFN'), 100000.5000, 'cash AFN balance after opening');

  ------------------------------------------------------------------
  -- 2. Unbalanced entry rejected by fn_post_journal
  ------------------------------------------------------------------
  PERFORM tests.throws(format(
    'SELECT fn_post_journal(DATE ''2026-07-16'', ''bad'', '''', ''test'', NULL,
       jsonb_build_array(
         jsonb_build_object(''account_id'', %L, ''currency'', ''AFN'', ''debit'', ''100'', ''credit'', 0),
         jsonb_build_object(''account_id'', %L, ''currency'', ''AFN'', ''debit'', 0, ''credit'', ''99.9999'')))',
    acc_afn, acc_eq), '%does not balance%');

  ------------------------------------------------------------------
  -- 3. Per-currency balance: AFN legs balance, USD leg alone -> rejected
  ------------------------------------------------------------------
  PERFORM tests.throws(format(
    'SELECT fn_post_journal(DATE ''2026-07-16'', ''bad fx'', '''', ''test'', NULL,
       jsonb_build_array(
         jsonb_build_object(''account_id'', %L, ''currency'', ''AFN'', ''debit'', ''7100'', ''credit'', 0),
         jsonb_build_object(''account_id'', %L, ''currency'', ''AFN'', ''debit'', 0, ''credit'', ''7100''),
         jsonb_build_object(''account_id'', %L, ''currency'', ''USD'', ''debit'', ''100'', ''credit'', 0)))',
    acc_afn, acc_eq, acc_usd), '%does not balance%');

  ------------------------------------------------------------------
  -- 4. Direct SQL manipulation cannot create an unbalanced posted entry
  --    (deferred constraint trigger; forced immediate inside tests.throws)
  ------------------------------------------------------------------
  PERFORM tests.throws(format(
    'WITH e AS (
       INSERT INTO journal_entries (entry_no, fiscal_year, entry_date, description, status, posted_at)
       VALUES (999999, 2099, CURRENT_DATE, ''direct tamper'', ''posted'', now()) RETURNING id)
     INSERT INTO journal_lines (entry_id, line_no, account_id, currency, debit, credit)
     SELECT id, 1, %L::uuid, ''AFN''::currency_code, 5, 0 FROM e
     UNION ALL
     SELECT id, 2, %L::uuid, ''AFN''::currency_code, 3, 0 FROM e',
    acc_afn, acc_eq), '%does not balance%');

  ------------------------------------------------------------------
  -- 5. Posted entries and their lines are immutable
  ------------------------------------------------------------------
  PERFORM tests.throws(format('UPDATE journal_entries SET description = ''hacked'' WHERE id = %L', e1), '%immutable%');
  PERFORM tests.throws(format('DELETE FROM journal_entries WHERE id = %L', e1), '%immutable%');
  PERFORM tests.throws(format('UPDATE journal_lines SET debit = debit + 1 WHERE entry_id = %L AND debit > 0', e1), '%immutable%');
  PERFORM tests.throws(format('DELETE FROM journal_lines WHERE entry_id = %L', e1), '%immutable%');

  ------------------------------------------------------------------
  -- 6. Single-currency account rejects the other currency
  ------------------------------------------------------------------
  PERFORM tests.throws(format(
    'SELECT fn_post_journal(DATE ''2026-07-16'', ''wrong ccy'', '''', ''test'', NULL,
       jsonb_build_array(
         jsonb_build_object(''account_id'', %L, ''currency'', ''USD'', ''debit'', ''10'', ''credit'', 0),
         jsonb_build_object(''account_id'', %L, ''currency'', ''USD'', ''debit'', 0, ''credit'', ''10'')))',
    acc_afn, acc_eq), '%fixed to currency%');

  ------------------------------------------------------------------
  -- 7. Gapless sequential entry numbers within the fiscal year
  ------------------------------------------------------------------
  SELECT entry_no INTO n1 FROM journal_entries WHERE id = e1;
  e2 := fn_post_journal(DATE '2026-07-16', 'Opening cash USD', '', 'test', NULL,
    jsonb_build_array(
      jsonb_build_object('account_id', acc_usd, 'currency', 'USD', 'debit', '5000.0000', 'credit', 0),
      jsonb_build_object('account_id', acc_eq,  'currency', 'USD', 'debit', 0, 'credit', '5000.0000')));
  SELECT entry_no INTO n2 FROM journal_entries WHERE id = e2;
  PERFORM tests.eq(n2, n1 + 1, 'entry_no is sequential/gapless');

  ------------------------------------------------------------------
  -- 8. Reversal: admin only; nets to zero; original marked reversed
  ------------------------------------------------------------------
  SELECT id INTO admin_id FROM app_users WHERE role = 'admin' LIMIT 1;
  office_id := tests.mk_user('office1', 'office1@test.local');
  INSERT INTO app_users (id, full_name, role) VALUES (office_id, 'Office One', 'office')
  ON CONFLICT (id) DO NOTHING;

  -- office user may NOT reverse
  PERFORM tests.login(office_id);
  PERFORM tests.throws(format('SELECT fn_reverse_entry(%L, ''oops'')', e2), '%only an admin%');
  PERFORM tests.logout();

  -- admin reverses; reason required
  PERFORM tests.login(admin_id);
  PERFORM tests.throws(format('SELECT fn_reverse_entry(%L, '''')', e2), '%reason is required%');
  rev := fn_reverse_entry(e2, 'entered in error');
  PERFORM tests.logout();

  PERFORM tests.ok((SELECT status FROM journal_entries WHERE id = e2) = 'reversed',
    'original entry marked reversed');
  PERFORM tests.ok((SELECT reversal_of FROM journal_entries WHERE id = rev) = e2,
    'reversal links to original');
  PERFORM tests.eq(fn_account_balance(acc_usd, 'USD'), 0, 'USD cash nets to zero after reversal');

  -- a reversed entry cannot be reversed again or edited
  PERFORM tests.login(admin_id);
  PERFORM tests.throws(format('SELECT fn_reverse_entry(%L, ''again'')', e2), '%only posted entries%');
  PERFORM tests.logout();
  PERFORM tests.throws(format('UPDATE journal_entries SET status = ''posted'' WHERE id = %L', e2), '%immutable%');

  ------------------------------------------------------------------
  -- 9. Audit rows exist for journal writes
  ------------------------------------------------------------------
  PERFORM tests.ok(
    EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'journal_entries' AND row_pk = e1::text),
    'audit trail for journal entry');
END
$t$;
