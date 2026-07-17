-- ============================================================================
-- SARAI ERP — Phase 0: Foundation
-- Enums, app_users, role helpers, gapless document numbering, audit
-- infrastructure, auth events, grants.
--
-- Conventions used across ALL migrations:
--   * Money      : NUMERIC(18,4)   — never float/double precision
--   * Quantities : NUMERIC(14,3)
--   * FX rates   : NUMERIC(12,6)   — manual, per transaction
--   * Every business table: id uuid PK, created_at/by, updated_at/by,
--     an audit trigger (fn_audit) and a touch trigger (fn_touch).
--   * All financial computation lives in the database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Roles (exist already on Supabase; created here only for local test harness)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Functions are locked down by default; EXECUTE is granted explicitly.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Core enums
-- ---------------------------------------------------------------------------
CREATE TYPE currency_code AS ENUM ('AFN', 'USD');
CREATE TYPE app_role      AS ENUM ('admin', 'office', 'warehouse');

-- ---------------------------------------------------------------------------
-- app_users — application profile for every auth user
-- warehouse_id FK is added in Phase 2 (warehouses table does not exist yet).
-- ---------------------------------------------------------------------------
CREATE TABLE app_users (
  id           uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name    text NOT NULL CHECK (length(trim(full_name)) > 0),
  role         app_role NOT NULL,
  warehouse_id uuid NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid NULL,
  -- a warehouse user must be bound to exactly one warehouse; others to none
  CONSTRAINT app_users_warehouse_binding CHECK ((role = 'warehouse') = (warehouse_id IS NOT NULL))
);

COMMENT ON TABLE app_users IS 'Application user profiles. role=warehouse users are RLS-restricted to their own warehouse (sarai).';

-- ---------------------------------------------------------------------------
-- Session helpers
-- SECURITY DEFINER so they can read app_users regardless of RLS; used inside
-- RLS policies themselves (standard pattern to avoid policy recursion).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_role()
RETURNS app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM app_users WHERE id = auth.uid() AND is_active;
$$;

CREATE OR REPLACE FUNCTION app_current_warehouse()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT warehouse_id FROM app_users WHERE id = auth.uid() AND is_active;
$$;

CREATE OR REPLACE FUNCTION app_is_office()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce((SELECT role FROM app_users WHERE id = auth.uid() AND is_active) IN ('admin', 'office'), false);
$$;

CREATE OR REPLACE FUNCTION app_is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce((SELECT role FROM app_users WHERE id = auth.uid() AND is_active) = 'admin', false);
$$;

-- Best-effort email from the JWT (empty string when unavailable).
CREATE OR REPLACE FUNCTION fn_current_email()
RETURNS text
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '');
EXCEPTION WHEN OTHERS THEN
  RETURN '';
END;
$$;

GRANT EXECUTE ON FUNCTION app_current_role(), app_current_warehouse(), app_is_office(), app_is_admin(), fn_current_email() TO authenticated;

-- ---------------------------------------------------------------------------
-- fn_touch — maintains updated_at / updated_by on every business table
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_enable_touch(p_table regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER trg_touch BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION fn_touch()',
    p_table);
END;
$$;

-- ---------------------------------------------------------------------------
-- Gapless document numbering — PI-2026-0001, DSP-2026-0001, ORD-2026-0001 …
-- Numbers are assigned server-side inside the posting transaction, never by
-- the client. INSERT .. ON CONFLICT .. RETURNING is atomic and row-locked,
-- so two concurrent posts can never draw the same number, and a rolled-back
-- post rolls the counter back with it (no gaps).
-- DECISION: draft-capable documents receive their doc_no at POST time (drafts
-- may legally be deleted; posted documents form the gapless, auditable
-- series). Documents without a draft stage (orders) are numbered at creation.
-- ---------------------------------------------------------------------------
CREATE TABLE doc_counters (
  prefix  text NOT NULL,
  year    int  NOT NULL,
  last_no int  NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, year)
);

CREATE OR REPLACE FUNCTION fn_next_doc_no(p_prefix text, p_date date DEFAULT CURRENT_DATE)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_year int := extract(year FROM p_date)::int;
  v_no   int;
BEGIN
  INSERT INTO doc_counters (prefix, year, last_no)
  VALUES (p_prefix, v_year, 1)
  ON CONFLICT (prefix, year)
  DO UPDATE SET last_no = doc_counters.last_no + 1
  RETURNING last_no INTO v_no;

  RETURN p_prefix || '-' || v_year::text || '-' || lpad(v_no::text, 4, '0');
END;
$$;

-- ---------------------------------------------------------------------------
-- Audit trail — one generic trigger on every business table.
-- audit_log is INSERT-only: UPDATE/DELETE raise, privileges are revoked, and
-- application code never uses the service key.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    uuid NULL,
  user_email text NOT NULL DEFAULT '',
  table_name text NOT NULL,
  row_pk     text NOT NULL,
  action     text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_row    jsonb NULL,
  new_row    jsonb NULL,
  ip         text NULL
);

CREATE INDEX idx_audit_log_table_row ON audit_log (table_name, row_pk);
CREATE INDEX idx_audit_log_at        ON audit_log (at);
CREATE INDEX idx_audit_log_user      ON audit_log (user_id);

CREATE OR REPLACE FUNCTION fn_audit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pk text;
BEGIN
  v_pk := coalesce(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id', '');
  INSERT INTO audit_log (user_id, user_email, table_name, row_pk, action, old_row, new_row)
  VALUES (
    auth.uid(),
    fn_current_email(),
    TG_TABLE_NAME,
    v_pk,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION fn_audit_log_is_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;

CREATE TRIGGER trg_audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log_is_append_only();

-- helper: attach the audit trigger to a table
CREATE OR REPLACE FUNCTION fn_enable_audit(p_table regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION fn_audit()',
    p_table);
END;
$$;

-- ---------------------------------------------------------------------------
-- Auth events (login / logout) — populated via fn_log_auth_event RPC called
-- by the client on sign-in/sign-out.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    uuid NOT NULL,
  user_email text NOT NULL DEFAULT '',
  event_type text NOT NULL CHECK (event_type IN ('login', 'logout')),
  user_agent text NULL
);

CREATE OR REPLACE FUNCTION fn_log_auth_event(p_event_type text, p_user_agent text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_event_type NOT IN ('login', 'logout') THEN
    RAISE EXCEPTION 'invalid auth event type %', p_event_type;
  END IF;
  INSERT INTO auth_events (user_id, user_email, event_type, user_agent)
  VALUES (auth.uid(), fn_current_email(), p_event_type, p_user_agent);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_log_auth_event(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Admin bootstrap — the very first user to call this becomes admin; afterwards
-- only an existing admin can manage users (see RLS below).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bootstrap_admin(p_full_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM app_users WHERE role = 'admin' AND is_active) THEN
    RAISE EXCEPTION 'an active admin already exists; ask an admin to create your account';
  END IF;
  INSERT INTO app_users (id, full_name, role, created_by)
  VALUES (auth.uid(), p_full_name, 'admin', auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION fn_bootstrap_admin(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS for Phase 0 tables
-- ---------------------------------------------------------------------------
ALTER TABLE app_users   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_counters ENABLE ROW LEVEL SECURITY;

-- app_users: everyone sees own row; admin/office see all (needed to display
-- creator names on documents); only admin writes.
CREATE POLICY app_users_select ON app_users FOR SELECT TO authenticated
  USING (id = auth.uid() OR app_is_office());
CREATE POLICY app_users_insert ON app_users FOR INSERT TO authenticated
  WITH CHECK (app_is_admin());
CREATE POLICY app_users_update ON app_users FOR UPDATE TO authenticated
  USING (app_is_admin()) WITH CHECK (app_is_admin());
-- no DELETE policy: users are deactivated, never deleted

-- audit_log / auth_events: admin read-only from the client
CREATE POLICY audit_log_select ON audit_log FOR SELECT TO authenticated
  USING (app_is_admin());
CREATE POLICY auth_events_select ON auth_events FOR SELECT TO authenticated
  USING (app_is_admin());
-- doc_counters: no client access at all (no policies) — functions only.

GRANT SELECT, INSERT, UPDATE ON app_users TO authenticated;
GRANT SELECT ON audit_log TO authenticated;
GRANT SELECT ON auth_events TO authenticated;

-- audit + touch on app_users
SELECT fn_enable_audit('app_users');
SELECT fn_enable_touch('app_users');
