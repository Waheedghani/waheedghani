-- ============================================================================
-- SARAI ERP — Phase 6: Saraf (صراف) transactions
-- The saraf LEDGER is the journal (account range 1500). saraf_transactions is
-- the hawala-numbered register: standalone deposits/withdrawals post their
-- own journal entries; rows linked to warehouse payments are created
-- automatically by the payment posting and carry no journal of their own.
-- Sarafs NEVER appear in the Roznamcha (only physical drawer cash does) and
-- never pay Malaysian suppliers.
-- ============================================================================

CREATE TYPE saraf_direction AS ENUM ('in', 'out');
-- 'in'  = money moves INTO the saraf's hands (drawer -> saraf): DR saraf / CR drawer
-- 'out' = saraf releases cash to the drawer:                    DR drawer / CR saraf

CREATE TABLE saraf_transactions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no             text NULL UNIQUE,
  txn_date           date NOT NULL,
  saraf_id           uuid NOT NULL REFERENCES sarafs (id),
  direction          saraf_direction NOT NULL,
  currency           currency_code NOT NULL,
  amount             numeric(18,4) NOT NULL CHECK (amount > 0),
  hawala_number      text NULL,
  description        text NOT NULL DEFAULT '',
  description_ps     text NOT NULL DEFAULT '',
  linked_source_type text NULL,
  linked_source_id   uuid NULL,
  note               text NULL,
  status             doc_status NOT NULL DEFAULT 'draft',
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NULL DEFAULT auth.uid(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NULL,
  posted_by          uuid NULL,
  posted_at          timestamptz NULL,
  CONSTRAINT st_posted_doc_no CHECK (status = 'draft' OR doc_no IS NOT NULL)
);

CREATE INDEX idx_st_saraf ON saraf_transactions (saraf_id);
CREATE INDEX idx_st_linked ON saraf_transactions (linked_source_type, linked_source_id);

SELECT fn_enable_doc_immutability('saraf_transactions');

-- ---------------------------------------------------------------------------
-- POSTING: standalone saraf transaction (deposit into / withdrawal from saraf)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_saraf_transaction(p_txn_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_txn    saraf_transactions%ROWTYPE;
  v_saraf  sarafs%ROWTYPE;
  v_drawer uuid;
  v_doc_no text;
  v_entry  uuid;
  v_saraf_line jsonb;
  v_cash_line  jsonb;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized to post saraf transactions';
  END IF;

  SELECT * INTO v_txn FROM saraf_transactions WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'saraf transaction not found'; END IF;
  IF v_txn.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft saraf transactions can be posted';
  END IF;
  IF v_txn.linked_source_type IS NOT NULL THEN
    RAISE EXCEPTION 'linked saraf records are posted by their source document';
  END IF;

  SELECT * INTO v_saraf FROM sarafs WHERE id = v_txn.saraf_id;
  SELECT id INTO v_drawer FROM accounts
   WHERE code = CASE v_txn.currency WHEN 'AFN' THEN '1000' ELSE '1001' END;

  v_doc_no := fn_next_doc_no('SRT', v_txn.txn_date);

  v_saraf_line := jsonb_build_object(
    'account_id', v_saraf.account_id, 'currency', v_txn.currency,
    'debit',  CASE WHEN v_txn.direction = 'in'  THEN v_txn.amount ELSE 0 END,
    'credit', CASE WHEN v_txn.direction = 'out' THEN v_txn.amount ELSE 0 END,
    'line_memo', coalesce('hawala ' || v_txn.hawala_number, ''));
  v_cash_line := jsonb_build_object(
    'account_id', v_drawer, 'currency', v_txn.currency,
    'debit',  CASE WHEN v_txn.direction = 'out' THEN v_txn.amount ELSE 0 END,
    'credit', CASE WHEN v_txn.direction = 'in'  THEN v_txn.amount ELSE 0 END);

  v_entry := fn_post_journal(
    v_txn.txn_date,
    'Saraf ' || v_txn.direction || ' ' || v_doc_no || ' — ' || v_saraf.name ||
      coalesce(': ' || nullif(v_txn.description, ''), ''),
    'صراف — ' || coalesce(v_saraf.name_ps, '') || ' ' || coalesce(v_txn.description_ps, ''),  -- DRAFT-PS
    'saraf_transaction', p_txn_id,
    jsonb_build_array(v_saraf_line, v_cash_line));

  PERFORM set_config('app.posting', 'on', true);
  UPDATE saraf_transactions
     SET status = 'posted', doc_no = v_doc_no, posted_by = auth.uid(), posted_at = now()
   WHERE id = p_txn_id;
  PERFORM set_config('app.posting', '', true);

  RETURN v_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_post_saraf_transaction(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Warehouse payments via saraf automatically register in the hawala book
-- (posted, linked; the payment's journal entry carries the ledger effect).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_wp_register_saraf_txn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wh_name text;
BEGIN
  IF NEW.status = 'posted' AND OLD.status = 'draft' AND NEW.method = 'saraf' THEN
    SELECT name INTO v_wh_name FROM warehouses WHERE id = NEW.warehouse_id;
    INSERT INTO saraf_transactions
      (txn_date, saraf_id, direction, currency, amount, hawala_number,
       description, description_ps, linked_source_type, linked_source_id,
       status, doc_no, posted_by, posted_at)
    VALUES
      (NEW.payment_date, NEW.saraf_id, 'in', NEW.currency, NEW.amount, NEW.hawala_number,
       'Warehouse payment ' || NEW.doc_no || ' — ' || coalesce(v_wh_name, ''),
       'د سرای تادیه ' || NEW.doc_no,  -- DRAFT-PS
       'warehouse_payment', NEW.id,
       'posted', fn_next_doc_no('SRT', NEW.payment_date), auth.uid(), now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wp_saraf_register AFTER UPDATE ON warehouse_payments
  FOR EACH ROW EXECUTE FUNCTION fn_wp_register_saraf_txn();

-- ---------------------------------------------------------------------------
-- Cash release now routes through the hawala register too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_saraf_cash_release(
  p_saraf_id uuid, p_currency currency_code, p_amount numeric,
  p_date date DEFAULT CURRENT_DATE, p_hawala_number text DEFAULT NULL,
  p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_txn_id uuid;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;
  INSERT INTO saraf_transactions
    (txn_date, saraf_id, direction, currency, amount, hawala_number, description, note)
  VALUES
    (p_date, p_saraf_id, 'out', p_currency, round(p_amount, 4), p_hawala_number,
     'Cash released to drawer', p_note)
  RETURNING id INTO v_txn_id;

  RETURN fn_post_saraf_transaction(v_txn_id);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_post_saraf_cash_release(uuid, currency_code, numeric, date, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE saraf_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY st_select ON saraf_transactions FOR SELECT TO authenticated USING (app_is_office());
CREATE POLICY st_insert ON saraf_transactions FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY st_update ON saraf_transactions FOR UPDATE TO authenticated
  USING (app_is_office() AND status = 'draft') WITH CHECK (app_is_office() AND status = 'draft');
CREATE POLICY st_delete ON saraf_transactions FOR DELETE TO authenticated
  USING (status = 'draft' AND (created_by = auth.uid() OR app_is_admin()));

GRANT SELECT, INSERT, UPDATE, DELETE ON saraf_transactions TO authenticated;

SELECT fn_enable_audit('saraf_transactions');
SELECT fn_enable_touch('saraf_transactions');
