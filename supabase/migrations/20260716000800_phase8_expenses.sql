-- ============================================================================
-- SARAI ERP — Phase 8: Office expenses
-- Categorized; paid via cash (feeds the Roznamcha through the drawer
-- accounts), bank, or saraf (feeds the saraf ledger — never the Roznamcha).
-- ============================================================================

CREATE TYPE office_paid_via AS ENUM ('cash', 'bank', 'saraf');

CREATE TABLE expense_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  name_ps    text NOT NULL DEFAULT '',
  account_id uuid NOT NULL REFERENCES accounts (id),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

CREATE TABLE office_expenses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no         text NULL UNIQUE,
  expense_date   date NOT NULL,
  category_id    uuid NOT NULL REFERENCES expense_categories (id),
  description    text NOT NULL,
  description_ps text NOT NULL DEFAULT '',
  currency       currency_code NOT NULL,
  amount         numeric(18,4) NOT NULL CHECK (amount > 0),
  paid_via       office_paid_via NOT NULL,
  bank_name      text NULL,
  saraf_id       uuid NULL REFERENCES sarafs (id),
  fx_rate        numeric(12,6) NULL CHECK (fx_rate IS NULL OR fx_rate > 0),
  status         doc_status NOT NULL DEFAULT 'draft',
  notes          text NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NULL DEFAULT auth.uid(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid NULL,
  posted_by      uuid NULL,
  posted_at      timestamptz NULL,
  CONSTRAINT oex_bank_needs_name   CHECK (paid_via <> 'bank' OR bank_name IS NOT NULL),
  CONSTRAINT oex_saraf_needs_saraf CHECK (paid_via <> 'saraf' OR saraf_id IS NOT NULL),
  CONSTRAINT oex_posted_doc_no     CHECK (status = 'draft' OR doc_no IS NOT NULL)
);

CREATE INDEX idx_oex_date ON office_expenses (expense_date);

SELECT fn_enable_doc_immutability('office_expenses');

-- ---------------------------------------------------------------------------
-- POSTING: DR expense-category account / CR drawer | bank | saraf
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_office_expense(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_exp    office_expenses%ROWTYPE;
  v_cat    expense_categories%ROWTYPE;
  v_credit uuid;
  v_doc_no text;
  v_entry  uuid;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized to post office expenses';
  END IF;

  SELECT * INTO v_exp FROM office_expenses WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'office expense not found'; END IF;
  IF v_exp.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft expenses can be posted';
  END IF;

  SELECT * INTO v_cat FROM expense_categories WHERE id = v_exp.category_id;
  IF NOT v_cat.is_active THEN RAISE EXCEPTION 'expense category is inactive'; END IF;

  IF v_exp.paid_via = 'cash' THEN
    SELECT id INTO v_credit FROM accounts
     WHERE code = CASE v_exp.currency WHEN 'AFN' THEN '1000' ELSE '1001' END;
  ELSIF v_exp.paid_via = 'bank' THEN
    v_credit := fn_ensure_bank_account(v_exp.bank_name);
  ELSE
    SELECT account_id INTO v_credit FROM sarafs WHERE id = v_exp.saraf_id;
  END IF;

  v_doc_no := fn_next_doc_no('EXP', v_exp.expense_date);

  v_entry := fn_post_journal(
    v_exp.expense_date,
    'Office expense ' || v_doc_no || ' (' || v_cat.name || '): ' || v_exp.description,
    'د دفتر لګښت ' || v_doc_no || ' — ' || coalesce(v_cat.name_ps, '') || ': ' || coalesce(v_exp.description_ps, ''),  -- DRAFT-PS
    'office_expense', p_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_cat.account_id, 'currency', v_exp.currency,
                         'debit', v_exp.amount, 'credit', 0, 'fx_rate', v_exp.fx_rate),
      jsonb_build_object('account_id', v_credit, 'currency', v_exp.currency,
                         'debit', 0, 'credit', v_exp.amount, 'fx_rate', v_exp.fx_rate,
                         'line_memo', v_exp.paid_via::text)));

  -- paying through a saraf also lands in the hawala register
  IF v_exp.paid_via = 'saraf' THEN
    INSERT INTO saraf_transactions
      (txn_date, saraf_id, direction, currency, amount, description, description_ps,
       linked_source_type, linked_source_id, status, doc_no, posted_by, posted_at)
    VALUES
      (v_exp.expense_date, v_exp.saraf_id, 'out', v_exp.currency, v_exp.amount,
       'Office expense ' || v_doc_no || ': ' || v_exp.description,
       'د دفتر لګښت ' || v_doc_no,  -- DRAFT-PS
       'office_expense', p_id, 'posted', fn_next_doc_no('SRT', v_exp.expense_date),
       auth.uid(), now());
  END IF;

  PERFORM set_config('app.posting', 'on', true);
  UPDATE office_expenses
     SET status = 'posted', doc_no = v_doc_no, posted_by = auth.uid(), posted_at = now()
   WHERE id = p_id;
  PERFORM set_config('app.posting', '', true);

  RETURN v_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_post_office_expense(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_expenses    ENABLE ROW LEVEL SECURITY;

CREATE POLICY ec_select ON expense_categories FOR SELECT TO authenticated USING (app_is_office());
CREATE POLICY ec_insert ON expense_categories FOR INSERT TO authenticated WITH CHECK (app_is_admin());
CREATE POLICY ec_update ON expense_categories FOR UPDATE TO authenticated
  USING (app_is_admin()) WITH CHECK (app_is_admin());

CREATE POLICY oex_select ON office_expenses FOR SELECT TO authenticated USING (app_is_office());
CREATE POLICY oex_insert ON office_expenses FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY oex_update ON office_expenses FOR UPDATE TO authenticated
  USING (app_is_office() AND status = 'draft') WITH CHECK (app_is_office() AND status = 'draft');
CREATE POLICY oex_delete ON office_expenses FOR DELETE TO authenticated
  USING (status = 'draft' AND (created_by = auth.uid() OR app_is_admin()));

GRANT SELECT, INSERT, UPDATE ON expense_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON office_expenses TO authenticated;

SELECT fn_enable_audit(t) FROM unnest(ARRAY['expense_categories', 'office_expenses']::regclass[]) AS t;
SELECT fn_enable_touch(t) FROM unnest(ARRAY['expense_categories', 'office_expenses']::regclass[]) AS t;
