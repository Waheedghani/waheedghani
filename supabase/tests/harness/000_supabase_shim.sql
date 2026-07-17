-- ============================================================================
-- TEST HARNESS ONLY — never runs on a real Supabase project.
-- Recreates the minimal Supabase surface (auth schema, auth.uid(), JWT GUCs)
-- on a plain Postgres cluster so migrations, triggers, posting functions and
-- RLS can be exercised for real.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY,
  email text NOT NULL DEFAULT ''
);

-- Same contract as Supabase: uid comes from the request JWT claims.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT SELECT ON auth.users TO PUBLIC; -- test harness only

-- ---------------------------------------------------------------------------
-- Test helpers
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS tests;
GRANT USAGE ON SCHEMA tests TO PUBLIC;

-- Create an auth user (id derived from a stable label so tests are readable).
CREATE OR REPLACE FUNCTION tests.mk_user(p_label text, p_email text)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid := md5('test-user:' || p_label)::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_id, p_email)
  ON CONFLICT (id) DO NOTHING;
  RETURN v_id;
END;
$$;

-- Impersonate a user the way PostgREST does: set claims + switch role.
CREATE OR REPLACE FUNCTION tests.login(p_user uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tests.login: unknown user %', p_user;
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'email', v_email, 'role', 'authenticated')::text, false);
  PERFORM set_config('role', 'authenticated', false);
END;
$$;

CREATE OR REPLACE FUNCTION tests.logout()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', false);
  EXECUTE 'RESET ROLE';
END;
$$;

-- Assert that a statement fails with a message matching a LIKE pattern.
-- Forces deferred constraint triggers to fire inside the statement so
-- commit-time violations are testable.
CREATE OR REPLACE FUNCTION tests.throws(p_sql text, p_like text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    -- the subtransaction rollback restores the previous constraint mode,
    -- but be explicit so later statements in the caller stay deferred
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    IF SQLERRM LIKE p_like THEN
      RETURN; -- expected failure
    END IF;
    RAISE EXCEPTION E'statement failed with unexpected message.\nexpected LIKE: %\ngot: %',
      p_like, SQLERRM;
  END;
  RAISE EXCEPTION 'expected failure LIKE [%] but statement succeeded: %', p_like, p_sql;
END;
$$;

-- Numeric equality assertion with a helpful message.
CREATE OR REPLACE FUNCTION tests.eq(p_actual numeric, p_expected numeric, p_what text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ASSERT FAILED [%]: expected % got %', p_what, p_expected, p_actual;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION tests.ok(p_cond boolean, p_what text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_cond IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ASSERT FAILED [%]', p_what;
  END IF;
END;
$$;
