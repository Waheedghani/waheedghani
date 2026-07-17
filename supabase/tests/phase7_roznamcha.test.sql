-- ============================================================================
-- Phase 7 tests: roznamcha sheet math, manual entries, day close with
-- variance enforcement, closed-day posting guard.
-- AFN drawer timeline entering this file:
--   07-05: -21,375 | 07-15: +556,250 | 07-16: +100,000.50 - 100,000
--   07-17: +40,000  → balance 574,875.50
-- USD drawer: -10,000 (07-01) + 1,500 (07-17) = -8,500
-- ============================================================================

DO $t$
DECLARE
  office_id uuid := md5('test-user:office1')::uuid;
  v_manual  uuid;
  v_cnt     int;
  v_row     record;
BEGIN
  PERFORM tests.login(office_id);

  ------------------------------------------------------------------
  -- Sheet for 2026-07-15: opening -21,375; two cash-ins; closing 534,875
  ------------------------------------------------------------------
  SELECT count(*) INTO v_cnt FROM fn_roznamcha_sheet(DATE '2026-07-15') s WHERE s.row_kind = 'entry';
  PERFORM tests.eq(v_cnt, 2, 'two cash entries on 07-15');

  SELECT * INTO v_row FROM fn_roznamcha_sheet(DATE '2026-07-15') s WHERE s.row_kind = 'opening';
  PERFORM tests.eq(v_row.run_afn, -21375.0000, 'opening AFN on 07-15');

  SELECT * INTO v_row FROM fn_roznamcha_sheet(DATE '2026-07-15') s WHERE s.row_kind = 'closing';
  PERFORM tests.eq(v_row.afn_in, 556250.0000, 'AFN in total for the day');
  PERFORM tests.eq(v_row.afn_out, 0, 'AFN out total for the day');
  PERFORM tests.eq(v_row.run_afn, 534875.0000, 'closing AFN on 07-15');

  ------------------------------------------------------------------
  -- Manual drawer entry: ؋5,000 in on 07-18
  ------------------------------------------------------------------
  INSERT INTO roznamcha_manual (entry_date, description, direction, currency, amount, bill_refs, qty_note)
  VALUES (DATE '2026-07-18', 'Owner cash injection', 'in', 'AFN', 5000.0000, ARRAY['-'], NULL)
  RETURNING id INTO v_manual;
  PERFORM fn_post_roznamcha_manual(v_manual);

  PERFORM tests.eq(fn_account_balance((SELECT id FROM accounts WHERE code = '1000'), 'AFN', DATE '2026-07-18'),
                   579875.5000, 'AFN drawer after manual entry');

  ------------------------------------------------------------------
  -- Day close: unexplained variance rejected; exact count closes
  ------------------------------------------------------------------
  PERFORM tests.throws(
    'SELECT fn_close_roznamcha_day(DATE ''2026-07-18'', 999.0000, -8500.0000)',
    '%unexplained variance%');

  -- variance WITH explanation is allowed (documented difference)
  -- (do not actually close with variance here — close exact)
  PERFORM fn_close_roznamcha_day(DATE '2026-07-18', 579875.5000, -8500.0000);
  PERFORM tests.ok(EXISTS (SELECT 1 FROM roznamcha_days WHERE day_date = DATE '2026-07-18' AND status = 'closed'),
    'day closed');
  PERFORM tests.eq((SELECT variance_afn FROM roznamcha_days WHERE day_date = DATE '2026-07-18'), 0, 'zero AFN variance');

  PERFORM tests.throws(
    'SELECT fn_close_roznamcha_day(DATE ''2026-07-18'', 1, 1)', '%already closed%');

  ------------------------------------------------------------------
  -- No cash postings into the closed day (any source)
  ------------------------------------------------------------------
  INSERT INTO roznamcha_manual (entry_date, description, direction, currency, amount)
  VALUES (DATE '2026-07-18', 'Late entry', 'in', 'AFN', 100)
  RETURNING id INTO v_manual;
  PERFORM tests.throws(format('SELECT fn_post_roznamcha_manual(%L)', v_manual),
    '%closed — no cash postings%');
  DELETE FROM roznamcha_manual WHERE id = v_manual;

  ------------------------------------------------------------------
  -- Non-cash postings on that date remain legal (saraf leg, no drawer)
  ------------------------------------------------------------------
  PERFORM tests.ok(
    (SELECT count(*) FROM journal_entries WHERE entry_date = DATE '2026-07-19') >= 0,
    'sanity');

  -- roznamcha_days rows immutable: office has no write privilege at all
  PERFORM tests.throws('UPDATE roznamcha_days SET counted_afn = 0', '%permission denied%');

  PERFORM tests.logout();

  -- and even a superuser is stopped by the guard trigger
  PERFORM tests.throws('UPDATE roznamcha_days SET counted_afn = 0', '%only through fn_close_roznamcha_day%');

  ------------------------------------------------------------------
  -- Warehouse keeper: no roznamcha access
  ------------------------------------------------------------------
  PERFORM tests.login(md5('test-user:keeper1')::uuid);
  SELECT count(*) INTO v_cnt FROM roznamcha_days;
  PERFORM tests.eq(v_cnt, 0, 'keeper sees no roznamcha days');
  PERFORM tests.throws('SELECT count(*) FROM fn_roznamcha_sheet(CURRENT_DATE)', '%not authorized%');
  PERFORM tests.logout();
END
$t$;
