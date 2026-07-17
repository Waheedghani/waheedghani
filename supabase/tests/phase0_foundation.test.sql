-- ============================================================================
-- Phase 0 tests: document numbering, audit append-only, admin bootstrap.
-- ============================================================================

-- Gapless, per-year document numbering
DO $t$
DECLARE
  a text; b text; c text;
BEGIN
  a := fn_next_doc_no('TST', DATE '2026-07-16');
  b := fn_next_doc_no('TST', DATE '2026-07-16');
  c := fn_next_doc_no('TST', DATE '2027-01-01');
  PERFORM tests.ok(a = 'TST-2026-0001', 'first doc no, got ' || a);
  PERFORM tests.ok(b = 'TST-2026-0002', 'second doc no, got ' || b);
  PERFORM tests.ok(c = 'TST-2027-0001', 'new year restarts at 1, got ' || c);
END
$t$;

-- Audit rows are written and audit_log is append-only
DO $t$
BEGIN
  INSERT INTO accounts (code, name, type) VALUES ('9990', 'Audit Probe', 'equity');
  PERFORM tests.ok(
    EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'accounts' AND action = 'INSERT'
             AND new_row ->> 'code' = '9990'),
    'audit row written for accounts INSERT');
  PERFORM tests.throws('UPDATE audit_log SET user_email = ''tampered''', '%append-only%');
  PERFORM tests.throws('DELETE FROM audit_log', '%append-only%');
END
$t$;

-- Admin bootstrap: first user becomes admin, second is refused
DO $t$
DECLARE
  u1 uuid; u2 uuid;
BEGIN
  u1 := tests.mk_user('admin1', 'admin1@test.local');
  u2 := tests.mk_user('intruder', 'intruder@test.local');

  PERFORM tests.login(u1);
  PERFORM fn_bootstrap_admin('Admin One');
  PERFORM tests.logout();

  PERFORM tests.ok(
    EXISTS (SELECT 1 FROM app_users WHERE id = u1 AND role = 'admin' AND is_active),
    'first user bootstrapped as admin');

  PERFORM tests.login(u2);
  PERFORM tests.throws('SELECT fn_bootstrap_admin(''Imposter'')', '%admin already exists%');
  PERFORM tests.logout();

  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM app_users WHERE id = u2),
    'second user did not become admin');
END
$t$;

-- Auth event logging
DO $t$
DECLARE
  u1 uuid := md5('test-user:admin1')::uuid;
BEGIN
  PERFORM tests.login(u1);
  PERFORM fn_log_auth_event('login', 'sql-test');
  PERFORM tests.logout();
  PERFORM tests.ok(
    EXISTS (SELECT 1 FROM auth_events WHERE user_id = u1 AND event_type = 'login'),
    'auth event recorded');
END
$t$;
