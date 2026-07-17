-- ============================================================================
-- SARAI ERP — Phase 7: Roznamcha (روزنامچه) — the daily cash book.
-- ONLY physical drawer cash (accounts 1000 AFN / 1001 USD) appears here.
-- Saraf balances live in their own ledgers and never touch this book.
--
-- Rules enforced in the database:
--   * A day cannot close with an unexplained variance (counted vs computed).
--   * No cash posting may land on a date whose day is closed.
--   * The next day opens with yesterday's closing as its opening balance.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Manual drawer entries (cash in/out with no other source document);
-- posted against 3000 Equity (owner injections/drawings — D-020).
-- ---------------------------------------------------------------------------
CREATE TABLE roznamcha_manual (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no         text NULL UNIQUE,
  entry_date     date NOT NULL,
  description    text NOT NULL,
  description_ps text NOT NULL DEFAULT '',
  direction      saraf_direction NOT NULL,       -- 'in' = cash into drawer
  currency       currency_code NOT NULL,
  amount         numeric(18,4) NOT NULL CHECK (amount > 0),
  bill_refs      text[] NOT NULL DEFAULT '{}',
  qty_note       text NULL,
  status         doc_status NOT NULL DEFAULT 'draft',
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NULL DEFAULT auth.uid(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid NULL,
  posted_by      uuid NULL,
  posted_at      timestamptz NULL,
  CONSTRAINT rm_posted_doc_no CHECK (status = 'draft' OR doc_no IS NOT NULL)
);

SELECT fn_enable_doc_immutability('roznamcha_manual');

-- ---------------------------------------------------------------------------
-- Day close registry
-- ---------------------------------------------------------------------------
CREATE TABLE roznamcha_days (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_date             date NOT NULL UNIQUE,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  counted_afn          numeric(18,4) NULL,
  counted_usd          numeric(18,4) NULL,
  computed_afn         numeric(18,4) NULL,
  computed_usd         numeric(18,4) NULL,
  variance_afn         numeric(18,4) GENERATED ALWAYS AS (coalesce(counted_afn, 0) - coalesce(computed_afn, 0)) STORED,
  variance_usd         numeric(18,4) GENERATED ALWAYS AS (coalesce(counted_usd, 0) - coalesce(computed_usd, 0)) STORED,
  variance_explanation text NULL,
  closed_by            uuid NULL,
  closed_at            timestamptz NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NULL DEFAULT auth.uid(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid NULL
);

-- day rows change only through fn_close_roznamcha_day
CREATE OR REPLACE FUNCTION fn_rzd_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.posting', true) = 'on' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'roznamcha days change only through fn_close_roznamcha_day';
END;
$$;

CREATE TRIGGER trg_rzd_guard BEFORE INSERT OR UPDATE OR DELETE ON roznamcha_days
  FOR EACH ROW EXECUTE FUNCTION fn_rzd_guard();

-- ---------------------------------------------------------------------------
-- GUARD: no cash journal line may be posted into a closed day (HC-11 backstop)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_jl_closed_day_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_date date;
BEGIN
  IF (SELECT type FROM accounts WHERE id = NEW.account_id) <> 'cash' THEN
    RETURN NEW;
  END IF;
  SELECT entry_date INTO v_date FROM journal_entries WHERE id = NEW.entry_id;
  IF EXISTS (SELECT 1 FROM roznamcha_days
              WHERE day_date = v_date AND status = 'closed') THEN
    RAISE EXCEPTION 'the roznamcha for % is closed — no cash postings allowed on that date', v_date;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_jl_closed_day BEFORE INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION fn_jl_closed_day_guard();

-- ---------------------------------------------------------------------------
-- POSTING: manual drawer entry (against equity, D-020)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_roznamcha_manual(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row    roznamcha_manual%ROWTYPE;
  v_drawer uuid;
  v_equity uuid;
  v_doc_no text;
  v_entry  uuid;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized to post roznamcha entries';
  END IF;

  SELECT * INTO v_row FROM roznamcha_manual WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'roznamcha entry not found'; END IF;
  IF v_row.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft entries can be posted';
  END IF;

  SELECT id INTO v_drawer FROM accounts
   WHERE code = CASE v_row.currency WHEN 'AFN' THEN '1000' ELSE '1001' END;
  SELECT id INTO v_equity FROM accounts WHERE code = '3000';

  v_doc_no := fn_next_doc_no('RZM', v_row.entry_date);

  v_entry := fn_post_journal(
    v_row.entry_date,
    'Manual cash ' || v_row.direction || ' ' || v_doc_no || ': ' || v_row.description,
    'لاسي نغدې — ' || coalesce(v_row.description_ps, ''),  -- DRAFT-PS
    'roznamcha_manual', p_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_drawer, 'currency', v_row.currency,
        'debit',  CASE WHEN v_row.direction = 'in'  THEN v_row.amount ELSE 0 END,
        'credit', CASE WHEN v_row.direction = 'out' THEN v_row.amount ELSE 0 END,
        'line_memo', array_to_string(v_row.bill_refs, ', ') || coalesce(' ' || v_row.qty_note, '')),
      jsonb_build_object('account_id', v_equity, 'currency', v_row.currency,
        'debit',  CASE WHEN v_row.direction = 'out' THEN v_row.amount ELSE 0 END,
        'credit', CASE WHEN v_row.direction = 'in'  THEN v_row.amount ELSE 0 END)));

  PERFORM set_config('app.posting', 'on', true);
  UPDATE roznamcha_manual
     SET status = 'posted', doc_no = v_doc_no, posted_by = auth.uid(), posted_at = now()
   WHERE id = p_id;
  PERFORM set_config('app.posting', '', true);

  RETURN v_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_post_roznamcha_manual(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- The daily sheet: opening balances, every cash line of the day with running
-- balances per currency, closing balances. One function feeds both the
-- screen and the printable A4 sheet.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_roznamcha_sheet(p_date date)
RETURNS TABLE (
  row_kind       text,      -- 'opening' | 'entry' | 'closing'
  entry_no       bigint,
  source_type    text,
  source_id      uuid,
  description    text,
  description_ps text,
  bill_refs      text,
  afn_in         numeric,
  afn_out        numeric,
  usd_in         numeric,
  usd_out        numeric,
  run_afn        numeric,
  run_usd        numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_open_afn numeric;
  v_open_usd numeric;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_open_afn := fn_account_balance((SELECT a.id FROM accounts a WHERE a.code = '1000'), 'AFN', p_date - 1);
  v_open_usd := fn_account_balance((SELECT a.id FROM accounts a WHERE a.code = '1001'), 'USD', p_date - 1);

  RETURN QUERY
  WITH cash_lines AS (
    SELECT e.entry_no AS eno, e.source_type AS stype, e.source_id AS sid,
           e.description AS descr, e.description_ps AS descr_ps,
           coalesce(l.line_memo, '') AS memo,
           CASE WHEN l.currency = 'AFN' THEN l.debit  ELSE 0 END AS a_in,
           CASE WHEN l.currency = 'AFN' THEN l.credit ELSE 0 END AS a_out,
           CASE WHEN l.currency = 'USD' THEN l.debit  ELSE 0 END AS u_in,
           CASE WHEN l.currency = 'USD' THEN l.credit ELSE 0 END AS u_out,
           l.line_no AS lno
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id AND e.status IN ('posted', 'reversed')
      JOIN accounts a ON a.id = l.account_id AND a.type = 'cash'
     WHERE e.entry_date = p_date
  ),
  united AS (
    SELECT 0 AS ord, NULL::bigint AS o_eno, 0 AS o_lno,
           'opening'::text AS r_kind, NULL::bigint AS r_eno, NULL::text AS r_stype, NULL::uuid AS r_sid,
           'Opening balance'::text AS r_descr, 'پرانیستی بیلانس'::text AS r_descr_ps, ''::text AS r_refs,  -- DRAFT-PS
           NULL::numeric AS r_ain, NULL::numeric AS r_aout, NULL::numeric AS r_uin, NULL::numeric AS r_uout,
           v_open_afn AS r_rafn, v_open_usd AS r_rusd
    UNION ALL
    SELECT 1, c.eno, c.lno,
           'entry', c.eno, c.stype, c.sid, c.descr, c.descr_ps, c.memo,
           c.a_in, c.a_out, c.u_in, c.u_out,
           v_open_afn + sum(c.a_in - c.a_out) OVER w,
           v_open_usd + sum(c.u_in - c.u_out) OVER w
      FROM cash_lines c
    WINDOW w AS (ORDER BY c.eno, c.lno)
    UNION ALL
    -- closing row: the in/out columns carry the DAY TOTALS
    SELECT 2, NULL, 0,
           'closing', NULL, NULL, NULL,
           'Closing balance', 'وروستی بیلانس', '',  -- DRAFT-PS
           (SELECT coalesce(sum(c.a_in), 0)  FROM cash_lines c),
           (SELECT coalesce(sum(c.a_out), 0) FROM cash_lines c),
           (SELECT coalesce(sum(c.u_in), 0)  FROM cash_lines c),
           (SELECT coalesce(sum(c.u_out), 0) FROM cash_lines c),
           v_open_afn + (SELECT coalesce(sum(c.a_in - c.a_out), 0) FROM cash_lines c),
           v_open_usd + (SELECT coalesce(sum(c.u_in - c.u_out), 0) FROM cash_lines c)
  )
  SELECT u.r_kind, u.r_eno, u.r_stype, u.r_sid, u.r_descr, u.r_descr_ps, u.r_refs,
         u.r_ain, u.r_aout, u.r_uin, u.r_uout, u.r_rafn, u.r_rusd
    FROM united u
   ORDER BY u.ord, u.o_eno NULLS FIRST, u.o_lno;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_roznamcha_sheet(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Day close: counted cash must equal computed, or carry an explanation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_close_roznamcha_day(
  p_date        date,
  p_counted_afn numeric,
  p_counted_usd numeric,
  p_explanation text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_afn numeric;
  v_usd numeric;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized to close the roznamcha';
  END IF;
  IF p_counted_afn IS NULL OR p_counted_usd IS NULL THEN
    RAISE EXCEPTION 'both counted AFN and counted USD are required';
  END IF;
  IF EXISTS (SELECT 1 FROM roznamcha_days WHERE day_date = p_date AND status = 'closed') THEN
    RAISE EXCEPTION 'day % is already closed', p_date;
  END IF;

  v_afn := fn_account_balance((SELECT id FROM accounts WHERE code = '1000'), 'AFN', p_date);
  v_usd := fn_account_balance((SELECT id FROM accounts WHERE code = '1001'), 'USD', p_date);

  IF (round(p_counted_afn, 4) <> v_afn OR round(p_counted_usd, 4) <> v_usd)
     AND (p_explanation IS NULL OR length(trim(p_explanation)) = 0) THEN
    RAISE EXCEPTION 'the day cannot close with an unexplained variance (computed AFN %, USD %; counted AFN %, USD %)',
      v_afn, v_usd, p_counted_afn, p_counted_usd;
  END IF;

  PERFORM set_config('app.posting', 'on', true);
  INSERT INTO roznamcha_days
    (day_date, status, counted_afn, counted_usd, computed_afn, computed_usd,
     variance_explanation, closed_by, closed_at)
  VALUES
    (p_date, 'closed', round(p_counted_afn, 4), round(p_counted_usd, 4), v_afn, v_usd,
     nullif(trim(coalesce(p_explanation, '')), ''), auth.uid(), now())
  ON CONFLICT (day_date) DO UPDATE
    SET status = 'closed',
        counted_afn = excluded.counted_afn,
        counted_usd = excluded.counted_usd,
        computed_afn = excluded.computed_afn,
        computed_usd = excluded.computed_usd,
        variance_explanation = excluded.variance_explanation,
        closed_by = excluded.closed_by,
        closed_at = excluded.closed_at;
  PERFORM set_config('app.posting', '', true);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_close_roznamcha_day(date, numeric, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE roznamcha_manual ENABLE ROW LEVEL SECURITY;
ALTER TABLE roznamcha_days   ENABLE ROW LEVEL SECURITY;

CREATE POLICY rm_select ON roznamcha_manual FOR SELECT TO authenticated USING (app_is_office());
CREATE POLICY rm_insert ON roznamcha_manual FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY rm_update ON roznamcha_manual FOR UPDATE TO authenticated
  USING (app_is_office() AND status = 'draft') WITH CHECK (app_is_office() AND status = 'draft');
CREATE POLICY rm_delete ON roznamcha_manual FOR DELETE TO authenticated
  USING (status = 'draft' AND (created_by = auth.uid() OR app_is_admin()));

CREATE POLICY rzd_select ON roznamcha_days FOR SELECT TO authenticated USING (app_is_office());

GRANT SELECT, INSERT, UPDATE, DELETE ON roznamcha_manual TO authenticated;
GRANT SELECT ON roznamcha_days TO authenticated;

SELECT fn_enable_audit(t) FROM unnest(ARRAY['roznamcha_manual', 'roznamcha_days']::regclass[]) AS t;
SELECT fn_enable_touch(t) FROM unnest(ARRAY['roznamcha_manual', 'roznamcha_days']::regclass[]) AS t;
