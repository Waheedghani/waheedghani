-- ============================================================================
-- SARAI ERP — Phase 1: Financial core
-- Chart of accounts, double-entry journal, balance + immutability triggers,
-- generic posting function, reversal function.
--
-- INVARIANTS (enforced here, in the database):
--   1. A posted journal entry ALWAYS balances: SUM(debit) = SUM(credit)
--      per currency within the entry (deferred constraint triggers).
--   2. A posted entry and its lines can NEVER be updated or deleted.
--      Corrections happen by reversal entries only.
--   3. Currencies never mix: every line carries its own currency; single-
--      currency accounts (cash drawers) reject lines in the other currency.
--   4. entry_no is gapless per fiscal year, assigned server-side at post.
--   5. Only plpgsql posting functions write journal rows (no client grants).
-- ============================================================================

CREATE TYPE account_type AS ENUM (
  'cash', 'bank', 'inventory', 'transit', 'warehouse_receivable', 'saraf',
  'supplier_payable', 'revenue', 'cogs', 'import_expense', 'waste_expense',
  'office_expense', 'equity', 'fx_clearing'
);

CREATE TYPE entry_status AS ENUM ('draft', 'posted', 'reversed');

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- Fixed chart rows are seeded (seed.sql); party/order accounts are created
-- automatically with dotted range codes, e.g. warehouse receivables
-- 1400-0001, 1400-0002 …
-- DECISION: auto-created accounts use "<range>-<seq>" text codes so a numeric
-- range like 1300–1399 can never be exhausted while staying sortable and
-- recognizable. Fixed chart accounts keep their plain numeric codes.
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE CHECK (code ~ '^[0-9]{4}(-[0-9]{4})?$'),
  name           text NOT NULL,
  name_ps        text NOT NULL DEFAULT '',
  type           account_type NOT NULL,
  -- cash drawer accounts are single-currency; NULL = account may carry both
  fixed_currency currency_code NULL,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NULL DEFAULT auth.uid(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid NULL
);

-- Allocate the next code inside a numeric range, e.g. fn_next_account_code(1400) -> '1400-0007'.
-- Serialized with an advisory lock so concurrent party creation cannot collide.
CREATE OR REPLACE FUNCTION fn_next_account_code(p_range int)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_next int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('accounts_code_range'), p_range);
  SELECT coalesce(max(split_part(code, '-', 2)::int), 0) + 1
    INTO v_next
    FROM accounts
   WHERE code LIKE p_range::text || '-%';
  IF v_next > 9999 THEN
    RAISE EXCEPTION 'account code range % is exhausted', p_range;
  END IF;
  RETURN p_range::text || '-' || lpad(v_next::text, 4, '0');
END;
$$;

-- Find-or-create the bank account for a given bank name (range 1100).
CREATE OR REPLACE FUNCTION fn_ensure_bank_account(p_bank_name text)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
  v_name text := trim(p_bank_name);
BEGIN
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'bank name is required';
  END IF;
  SELECT id INTO v_id FROM accounts WHERE type = 'bank' AND lower(name) = lower(v_name);
  IF v_id IS NULL THEN
    INSERT INTO accounts (code, name, name_ps, type)
    VALUES (fn_next_account_code(1100), v_name, v_name, 'bank')
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Journal
-- ---------------------------------------------------------------------------
CREATE TABLE journal_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_no       bigint NULL,          -- gapless per fiscal year, set at post
  fiscal_year    int NULL,
  entry_date     date NOT NULL,
  description    text NOT NULL,
  description_ps text NOT NULL DEFAULT '',
  source_type    text NULL,            -- e.g. 'purchase_invoice', 'dispatch_invoice'
  source_id      uuid NULL,
  status         entry_status NOT NULL DEFAULT 'draft',
  reversal_of    uuid NULL REFERENCES journal_entries (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NULL DEFAULT auth.uid(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid NULL,
  posted_by      uuid NULL,
  posted_at      timestamptz NULL,
  CONSTRAINT je_posted_fields CHECK (
    status = 'draft' OR (entry_no IS NOT NULL AND fiscal_year IS NOT NULL AND posted_at IS NOT NULL)
  ),
  UNIQUE (fiscal_year, entry_no)
);

CREATE INDEX idx_je_source ON journal_entries (source_type, source_id);
CREATE INDEX idx_je_date   ON journal_entries (entry_date);

CREATE TABLE journal_lines (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id   uuid NOT NULL REFERENCES journal_entries (id) ON DELETE CASCADE,
  line_no    int NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts (id),
  currency   currency_code NOT NULL,
  debit      numeric(18,4) NOT NULL DEFAULT 0,
  credit     numeric(18,4) NOT NULL DEFAULT 0,
  fx_rate    numeric(12,6) NULL CHECK (fx_rate IS NULL OR fx_rate > 0),
  fx_note    text NULL,
  line_memo  text NULL,
  CONSTRAINT jl_one_side       CHECK (debit = 0 OR credit = 0),
  CONSTRAINT jl_non_negative   CHECK (debit >= 0 AND credit >= 0),
  CONSTRAINT jl_non_zero       CHECK (debit <> 0 OR credit <> 0),
  UNIQUE (entry_id, line_no)
);

CREATE INDEX idx_jl_entry   ON journal_lines (entry_id);
CREATE INDEX idx_jl_account ON journal_lines (account_id, currency);

-- Gapless journal numbering per fiscal year
CREATE TABLE journal_counters (
  fiscal_year int PRIMARY KEY,
  last_no     bigint NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION fn_next_entry_no(p_year int)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_no bigint;
BEGIN
  INSERT INTO journal_counters (fiscal_year, last_no)
  VALUES (p_year, 1)
  ON CONFLICT (fiscal_year)
  DO UPDATE SET last_no = journal_counters.last_no + 1
  RETURNING last_no INTO v_no;
  RETURN v_no;
END;
$$;

-- ---------------------------------------------------------------------------
-- TRIGGER: single-currency accounts reject foreign-currency lines
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_jl_check_account_currency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_fixed currency_code;
  v_active boolean;
BEGIN
  SELECT fixed_currency, is_active INTO v_fixed, v_active
    FROM accounts WHERE id = NEW.account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal line references unknown account %', NEW.account_id;
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'account is inactive and cannot receive postings';
  END IF;
  IF v_fixed IS NOT NULL AND NEW.currency <> v_fixed THEN
    RAISE EXCEPTION 'account is fixed to currency %, got %', v_fixed, NEW.currency;
  END IF;
  -- scale guard: amounts must already be exact at 4 decimal places
  IF NEW.debit <> round(NEW.debit, 4) OR NEW.credit <> round(NEW.credit, 4) THEN
    RAISE EXCEPTION 'journal amounts must have at most 4 decimal places';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_jl_account_currency
  BEFORE INSERT OR UPDATE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION fn_jl_check_account_currency();

-- ---------------------------------------------------------------------------
-- BALANCE ENFORCEMENT — deferred constraint triggers.
-- At COMMIT, every posted entry touched in the transaction must balance per
-- currency and have at least two lines. It is therefore impossible for an
-- unbalanced posted entry to ever exist in this database.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_assert_entry_balanced(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_status entry_status;
  v_bad record;
  v_line_count int;
BEGIN
  SELECT status INTO v_status FROM journal_entries WHERE id = p_entry_id;
  IF NOT FOUND OR v_status = 'draft' THEN
    RETURN; -- drafts may be transiently unbalanced
  END IF;

  SELECT count(*) INTO v_line_count FROM journal_lines WHERE entry_id = p_entry_id;
  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'journal entry % must have at least 2 lines (has %)', p_entry_id, v_line_count;
  END IF;

  SELECT currency, sum(debit) AS d, sum(credit) AS c
    INTO v_bad
    FROM journal_lines
   WHERE entry_id = p_entry_id
   GROUP BY currency
  HAVING sum(debit) <> sum(credit)
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'journal entry % does not balance in %: debits % <> credits %',
      p_entry_id, v_bad.currency, v_bad.d, v_bad.c;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fn_jl_balance_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fn_assert_entry_balanced(coalesce(NEW.entry_id, OLD.entry_id));
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_jl_balance
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_jl_balance_guard();

CREATE OR REPLACE FUNCTION fn_je_balance_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fn_assert_entry_balanced(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_je_balance
  AFTER INSERT OR UPDATE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_je_balance_guard();

-- ---------------------------------------------------------------------------
-- IMMUTABILITY — posted entries are frozen forever.
-- The ONLY permitted mutation is status posted -> reversed, performed by
-- fn_reverse_entry under a transaction-local flag, with every other column
-- unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_je_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'posted journal entries are immutable and can never be deleted; post a reversal instead';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD.status = 'draft' THEN
    RETURN NEW; -- drafts are freely editable (including draft -> posted)
  END IF;

  IF OLD.status = 'posted'
     AND NEW.status = 'reversed'
     AND current_setting('app.allow_reversal_mark', true) = 'on'
     AND (to_jsonb(NEW) - 'status' - 'updated_at' - 'updated_by')
       = (to_jsonb(OLD) - 'status' - 'updated_at' - 'updated_by') THEN
    RETURN NEW; -- fn_reverse_entry marking the original
  END IF;

  RAISE EXCEPTION 'journal entry % is % and immutable; corrections require a reversal entry',
    OLD.id, OLD.status;
END;
$$;

CREATE TRIGGER trg_je_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION fn_je_immutable();

CREATE OR REPLACE FUNCTION fn_jl_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status entry_status;
BEGIN
  SELECT status INTO v_status FROM journal_entries
   WHERE id = coalesce(OLD.entry_id, NEW.entry_id);
  -- no parent row: cascade from a legal draft-entry delete
  IF FOUND AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'lines of a % journal entry are immutable', v_status;
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_jl_immutable
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION fn_jl_immutable();

-- ---------------------------------------------------------------------------
-- fn_post_journal — the ONLY way journal rows are created.
-- Internal: EXECUTE is NOT granted to any client role; business posting
-- functions (SECURITY DEFINER, with explicit role checks) call it.
-- Lines arrive as jsonb:
--   [{"account_id": "...", "currency": "AFN", "debit": "100.0000",
--     "credit": 0, "fx_rate": null, "fx_note": null, "line_memo": null}, ...]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_journal(
  p_entry_date     date,
  p_description    text,
  p_description_ps text,
  p_source_type    text,
  p_source_id      uuid,
  p_lines          jsonb,
  p_reversal_of    uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id uuid;
  v_year     int := extract(year FROM p_entry_date)::int;
  v_line     jsonb;
  v_line_no  int := 0;
  v_currency currency_code;
  v_sums     record;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'a journal entry requires at least 2 lines';
  END IF;

  -- fail fast with a clear message before touching tables
  FOR v_sums IN
    SELECT (l ->> 'currency') AS currency,
           sum(coalesce((l ->> 'debit')::numeric, 0))  AS d,
           sum(coalesce((l ->> 'credit')::numeric, 0)) AS c
      FROM jsonb_array_elements(p_lines) AS l
     GROUP BY (l ->> 'currency')
  LOOP
    IF v_sums.d <> v_sums.c THEN
      RAISE EXCEPTION 'entry does not balance in %: debits % <> credits %',
        v_sums.currency, v_sums.d, v_sums.c;
    END IF;
  END LOOP;

  -- Insert as draft, add lines, then flip to posted: the balance guard sees
  -- the complete entry regardless of whether constraint triggers run
  -- deferred (normal) or immediate.
  INSERT INTO journal_entries
    (entry_no, fiscal_year, entry_date, description, description_ps,
     source_type, source_id, status, reversal_of, posted_by, posted_at)
  VALUES
    (fn_next_entry_no(v_year), v_year, p_entry_date, p_description,
     coalesce(p_description_ps, ''), p_source_type, p_source_id, 'draft',
     p_reversal_of, auth.uid(), now())
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_no := v_line_no + 1;
    v_currency := (v_line ->> 'currency')::currency_code;
    INSERT INTO journal_lines
      (entry_id, line_no, account_id, currency, debit, credit, fx_rate, fx_note, line_memo)
    VALUES
      (v_entry_id,
       v_line_no,
       (v_line ->> 'account_id')::uuid,
       v_currency,
       round(coalesce((v_line ->> 'debit')::numeric, 0), 4),
       round(coalesce((v_line ->> 'credit')::numeric, 0), 4),
       (v_line ->> 'fx_rate')::numeric,
       v_line ->> 'fx_note',
       v_line ->> 'line_memo');
  END LOOP;

  UPDATE journal_entries SET status = 'posted' WHERE id = v_entry_id;

  RETURN v_entry_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- fn_reverse_entry — posts the exact mirror entry and marks the original
-- 'reversed'. Admin only (Section 8).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_reverse_entry(p_entry_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_orig  journal_entries%ROWTYPE;
  v_lines jsonb;
  v_rev_id uuid;
BEGIN
  IF NOT app_is_admin() THEN
    RAISE EXCEPTION 'only an admin may reverse a posted entry';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a reversal reason is required';
  END IF;

  SELECT * INTO v_orig FROM journal_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal entry % not found', p_entry_id;
  END IF;
  IF v_orig.status <> 'posted' THEN
    RAISE EXCEPTION 'only posted entries can be reversed (entry is %)', v_orig.status;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'account_id', account_id,
           'currency',   currency,
           'debit',      credit,   -- mirrored
           'credit',     debit,    -- mirrored
           'fx_rate',    fx_rate,
           'fx_note',    fx_note,
           'line_memo',  line_memo
         ) ORDER BY line_no)
    INTO v_lines
    FROM journal_lines WHERE entry_id = p_entry_id;

  v_rev_id := fn_post_journal(
    CURRENT_DATE,
    'REVERSAL of JE ' || v_orig.fiscal_year || '-' || v_orig.entry_no || ': ' || p_reason,
    'د ثبت بیرته کول: ' || coalesce(v_orig.description_ps, ''),  -- DRAFT-PS
    v_orig.source_type, v_orig.source_id, v_lines, p_entry_id);

  PERFORM set_config('app.allow_reversal_mark', 'on', true);
  UPDATE journal_entries SET status = 'reversed' WHERE id = p_entry_id;
  PERFORM set_config('app.allow_reversal_mark', '', true);

  RETURN v_rev_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_reverse_entry(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Account balance helpers — ALL balance math happens here, in SQL.
-- ---------------------------------------------------------------------------
-- security_invoker: the view must respect the querying user's RLS, never the
-- view owner's (a plain view would silently bypass RLS on Supabase).
CREATE OR REPLACE VIEW v_account_balances WITH (security_invoker = true) AS
SELECT a.id AS account_id, a.code, a.name, a.name_ps, a.type,
       l.currency,
       sum(l.debit)  AS total_debit,
       sum(l.credit) AS total_credit,
       sum(l.debit - l.credit) AS balance -- positive = net debit
  FROM accounts a
  JOIN journal_lines l ON l.account_id = a.id
  JOIN journal_entries e ON e.id = l.entry_id AND e.status IN ('posted', 'reversed')
 GROUP BY a.id, a.code, a.name, a.name_ps, a.type, l.currency;

COMMENT ON VIEW v_account_balances IS 'Net balance per account per currency over posted (and reversed — they net out via mirror entries) journal lines. Positive = net debit.';

CREATE OR REPLACE FUNCTION fn_account_balance(p_account_id uuid, p_currency currency_code, p_as_of date DEFAULT NULL)
RETURNS numeric
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(sum(l.debit - l.credit), 0)
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.entry_id
   WHERE l.account_id = p_account_id
     AND l.currency = p_currency
     AND e.status IN ('posted', 'reversed')
     AND (p_as_of IS NULL OR e.entry_date <= p_as_of);
$$;

-- ---------------------------------------------------------------------------
-- RLS — journals are readable by admin/office; warehouse users get an
-- additional policy in Phase 5 limited to their own receivable account.
-- No client role can EVER write journal rows (no write policies, no write
-- grants); posting functions run as the definer.
-- ---------------------------------------------------------------------------
ALTER TABLE accounts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounts_select ON accounts FOR SELECT TO authenticated
  USING (app_is_office());
CREATE POLICY je_select ON journal_entries FOR SELECT TO authenticated
  USING (app_is_office());
CREATE POLICY jl_select ON journal_lines FOR SELECT TO authenticated
  USING (app_is_office());

GRANT SELECT ON accounts, journal_entries, journal_lines TO authenticated;
GRANT SELECT ON v_account_balances TO authenticated;
GRANT EXECUTE ON FUNCTION fn_account_balance(uuid, currency_code, date) TO authenticated;

-- audit + touch
SELECT fn_enable_audit('accounts');
SELECT fn_enable_audit('journal_entries');
SELECT fn_enable_audit('journal_lines');
SELECT fn_enable_touch('accounts');
SELECT fn_enable_touch('journal_entries');
