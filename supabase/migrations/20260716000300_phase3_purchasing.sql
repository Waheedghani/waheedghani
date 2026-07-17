-- ============================================================================
-- SARAI ERP — Phase 3: Purchasing
-- Purchase invoices (draft -> post), supplier payments (advance / bank
-- settlement), per-invoice goods-in-transit accounts, ledger statements.
-- ============================================================================

CREATE TYPE doc_status   AS ENUM ('draft', 'posted', 'closed');
CREATE TYPE payment_kind AS ENUM ('advance', 'settlement');
CREATE TYPE pay_method   AS ENUM ('cash', 'bank');

-- ---------------------------------------------------------------------------
-- Purchase invoices
-- ---------------------------------------------------------------------------
CREATE TABLE purchase_invoices (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no                  text NULL UNIQUE,          -- assigned at post (D-001)
  invoice_date            date NOT NULL,
  supplier_id             uuid NOT NULL REFERENCES suppliers (id),
  invoice_number_supplier text NULL,
  bill_of_lading          text NULL,
  bank_name               text NULL,
  currency                currency_code NOT NULL DEFAULT 'USD',
  advance_payment         numeric(18,4) NOT NULL DEFAULT 0 CHECK (advance_payment >= 0),
  bank_balance_due        numeric(18,4) NOT NULL DEFAULT 0 CHECK (bank_balance_due >= 0),
  total_amount            numeric(18,4) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  transit_account_id      uuid NULL REFERENCES accounts (id),
  status                  doc_status NOT NULL DEFAULT 'draft',
  notes                   text NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL DEFAULT auth.uid(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NULL,
  posted_by               uuid NULL,
  posted_at               timestamptz NULL,
  CONSTRAINT pi_posted_doc_no CHECK (status = 'draft' OR doc_no IS NOT NULL)
);

CREATE INDEX idx_pi_supplier ON purchase_invoices (supplier_id);
CREATE INDEX idx_pi_date     ON purchase_invoices (invoice_date);

CREATE TABLE purchase_invoice_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          uuid NOT NULL REFERENCES purchase_invoices (id) ON DELETE CASCADE,
  variant_id          uuid NOT NULL REFERENCES product_variants (id),
  containers_count    int NOT NULL CHECK (containers_count > 0),
  units_per_container numeric(14,3) NOT NULL CHECK (units_per_container > 0),
  price_per_unit      numeric(18,4) NOT NULL CHECK (price_per_unit >= 0),
  container_numbers   text[] NOT NULL DEFAULT '{}',
  line_total          numeric(18,4) GENERATED ALWAYS AS
                        (round(containers_count * units_per_container * price_per_unit, 4)) STORED,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL DEFAULT auth.uid(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL
);

CREATE INDEX idx_pil_invoice ON purchase_invoice_lines (invoice_id);

-- container numbers must be unique within a line
CREATE OR REPLACE FUNCTION fn_pil_check_containers()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT count(*) FROM unnest(NEW.container_numbers) c)
     <> (SELECT count(DISTINCT c) FROM unnest(NEW.container_numbers) c) THEN
    RAISE EXCEPTION 'duplicate container numbers on one line';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pil_containers
  BEFORE INSERT OR UPDATE ON purchase_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION fn_pil_check_containers();

-- ---------------------------------------------------------------------------
-- Supplier payments (D-008): advance at purchase, bank settlement on receipt.
-- ---------------------------------------------------------------------------
CREATE TABLE supplier_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no              text NULL UNIQUE,
  payment_date        date NOT NULL,
  supplier_id         uuid NOT NULL REFERENCES suppliers (id),
  purchase_invoice_id uuid NULL REFERENCES purchase_invoices (id),
  kind                payment_kind NOT NULL,
  method              pay_method NOT NULL,
  bank_name           text NULL,
  currency            currency_code NOT NULL DEFAULT 'USD',
  amount              numeric(18,4) NOT NULL CHECK (amount > 0),
  fx_rate             numeric(12,6) NULL CHECK (fx_rate IS NULL OR fx_rate > 0),
  status              doc_status NOT NULL DEFAULT 'draft',
  notes               text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL DEFAULT auth.uid(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL,
  posted_by           uuid NULL,
  posted_at           timestamptz NULL,
  CONSTRAINT sp_bank_needs_name CHECK (method <> 'bank' OR bank_name IS NOT NULL),
  CONSTRAINT sp_posted_doc_no   CHECK (status = 'draft' OR doc_no IS NOT NULL)
);

CREATE INDEX idx_sp_supplier ON supplier_payments (supplier_id);

-- ---------------------------------------------------------------------------
-- Generic document immutability: posted business documents may only be
-- changed by posting functions (transaction-local flag app.posting), and
-- only drafts may be deleted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_doc_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.posting', true) = 'on' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status::text <> 'draft' THEN
      RAISE EXCEPTION '% % is % and cannot be deleted', TG_TABLE_NAME, OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status::text <> 'draft' THEN
    RAISE EXCEPTION '% % is % and immutable; corrections require a reversal', TG_TABLE_NAME, OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_enable_doc_immutability(p_table regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER trg_doc_immutable BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION fn_doc_immutable()',
    p_table);
END;
$$;

SELECT fn_enable_doc_immutability('purchase_invoices');
SELECT fn_enable_doc_immutability('supplier_payments');

-- Lines of a non-draft invoice are frozen (cascade deletes of drafts pass:
-- parent row is already gone when the cascade fires).
CREATE OR REPLACE FUNCTION fn_child_lines_frozen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_parent uuid;
BEGIN
  v_parent := coalesce(
    (to_jsonb(coalesce(NEW, OLD)) ->> TG_ARGV[1])::uuid, NULL);
  EXECUTE format('SELECT status::text FROM %I WHERE id = $1', TG_ARGV[0])
    INTO v_status USING v_parent;
  IF v_status IS NOT NULL AND v_status <> 'draft'
     AND current_setting('app.posting', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'lines of a % document are immutable', v_status;
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_pil_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON purchase_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION fn_child_lines_frozen('purchase_invoices', 'invoice_id');

-- ---------------------------------------------------------------------------
-- POSTING: purchase invoice
--   DR Goods in Transit (per-invoice 1300-xxxx account, invoice currency)
--   CR Supplier Payable
-- Validations: >=1 line; total = SUM(line_total); advance + bank due = total.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_purchase_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv      purchase_invoices%ROWTYPE;
  v_total    numeric(18,4);
  v_lines    int;
  v_supplier suppliers%ROWTYPE;
  v_transit  uuid;
  v_doc_no   text;
  v_entry    uuid;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized to post purchase invoices';
  END IF;

  SELECT * INTO v_inv FROM purchase_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase invoice not found'; END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft invoices can be posted (invoice is %)', v_inv.status;
  END IF;

  SELECT count(*), coalesce(sum(line_total), 0) INTO v_lines, v_total
    FROM purchase_invoice_lines WHERE invoice_id = p_invoice_id;
  IF v_lines = 0 THEN RAISE EXCEPTION 'invoice has no lines'; END IF;
  IF v_total <= 0 THEN RAISE EXCEPTION 'invoice total must be positive'; END IF;

  IF v_inv.advance_payment + v_inv.bank_balance_due <> v_total THEN
    RAISE EXCEPTION 'advance (%) + bank balance due (%) must equal invoice total (%)',
      v_inv.advance_payment, v_inv.bank_balance_due, v_total;
  END IF;

  SELECT * INTO v_supplier FROM suppliers WHERE id = v_inv.supplier_id;

  v_doc_no := fn_next_doc_no('PI', v_inv.invoice_date);

  -- per-invoice goods-in-transit account (1300 range)
  INSERT INTO accounts (code, name, name_ps, type)
  VALUES (fn_next_account_code(1300), 'Goods in Transit ' || v_doc_no,
          'په لار کې توکي ' || v_doc_no, 'transit')  -- DRAFT-PS
  RETURNING id INTO v_transit;

  v_entry := fn_post_journal(
    v_inv.invoice_date,
    'Purchase invoice ' || v_doc_no || ' — ' || v_supplier.name,
    'د پیرودنې بل ' || v_doc_no || ' — ' || coalesce(v_supplier.name_ps, ''),  -- DRAFT-PS
    'purchase_invoice', p_invoice_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_transit, 'currency', v_inv.currency,
                         'debit', v_total, 'credit', 0,
                         'line_memo', 'Goods in transit'),
      jsonb_build_object('account_id', v_supplier.account_id, 'currency', v_inv.currency,
                         'debit', 0, 'credit', v_total,
                         'line_memo', 'Supplier payable')));

  PERFORM set_config('app.posting', 'on', true);
  UPDATE purchase_invoices
     SET status = 'posted', doc_no = v_doc_no, total_amount = v_total,
         transit_account_id = v_transit, posted_by = auth.uid(), posted_at = now()
   WHERE id = p_invoice_id;
  PERFORM set_config('app.posting', '', true);

  RETURN v_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_post_purchase_invoice(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- POSTING: supplier payment (advance or settlement)
--   DR Supplier Payable / CR Cash drawer (currency-pinned) or Bank
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_supplier_payment(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pay      supplier_payments%ROWTYPE;
  v_supplier suppliers%ROWTYPE;
  v_credit   uuid;
  v_doc_no   text;
  v_entry    uuid;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized to post supplier payments';
  END IF;

  SELECT * INTO v_pay FROM supplier_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'supplier payment not found'; END IF;
  IF v_pay.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft payments can be posted (payment is %)', v_pay.status;
  END IF;

  SELECT * INTO v_supplier FROM suppliers WHERE id = v_pay.supplier_id;

  IF v_pay.method = 'cash' THEN
    SELECT id INTO v_credit FROM accounts
     WHERE code = CASE v_pay.currency WHEN 'AFN' THEN '1000' ELSE '1001' END;
  ELSE
    v_credit := fn_ensure_bank_account(v_pay.bank_name);
  END IF;

  v_doc_no := fn_next_doc_no('SP', v_pay.payment_date);

  v_entry := fn_post_journal(
    v_pay.payment_date,
    initcap(v_pay.kind::text) || ' payment ' || v_doc_no || ' — ' || v_supplier.name,
    'تادیه ' || v_doc_no || ' — ' || coalesce(v_supplier.name_ps, ''),  -- DRAFT-PS
    'supplier_payment', p_payment_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_supplier.account_id, 'currency', v_pay.currency,
                         'debit', v_pay.amount, 'credit', 0,
                         'fx_rate', v_pay.fx_rate,
                         'line_memo', v_pay.kind::text),
      jsonb_build_object('account_id', v_credit, 'currency', v_pay.currency,
                         'debit', 0, 'credit', v_pay.amount,
                         'fx_rate', v_pay.fx_rate,
                         'line_memo', CASE v_pay.method WHEN 'bank' THEN v_pay.bank_name ELSE 'cash drawer' END)));

  PERFORM set_config('app.posting', 'on', true);
  UPDATE supplier_payments
     SET status = 'posted', doc_no = v_doc_no, posted_by = auth.uid(), posted_at = now()
   WHERE id = p_payment_id;
  PERFORM set_config('app.posting', '', true);

  RETURN v_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_post_supplier_payment(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Ledger statement — one generic function powering supplier / warehouse-money
-- / saraf statements. Warehouse users may only read their own account.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_ledger_statement(
  p_account_id uuid,
  p_currency   currency_code,
  p_from       date,
  p_to         date
)
RETURNS TABLE (
  entry_date      date,
  entry_no        bigint,
  doc_ref         text,
  description     text,
  description_ps  text,
  debit           numeric,
  credit          numeric,
  running_balance numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role app_role := app_current_role();
  v_opening numeric;
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_role = 'warehouse' AND p_account_id IS DISTINCT FROM
     (SELECT w.account_id FROM warehouses w WHERE w.id = app_current_warehouse()) THEN
    RAISE EXCEPTION 'not authorized for this account';
  END IF;

  v_opening := fn_account_balance(p_account_id, p_currency, p_from - 1);

  RETURN QUERY
  SELECT p_from - 1, NULL::bigint, NULL::text,
         'Opening balance'::text, 'پرانیستی بیلانس'::text,  -- DRAFT-PS
         NULL::numeric, NULL::numeric, v_opening
  UNION ALL
  SELECT e.entry_date, e.entry_no,
         e.source_type || ':' || coalesce(e.source_id::text, ''),
         e.description, e.description_ps,
         l.debit, l.credit,
         v_opening + sum(l.debit - l.credit) OVER (ORDER BY e.entry_date, e.entry_no, l.line_no)
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.entry_id
   WHERE l.account_id = p_account_id
     AND l.currency = p_currency
     AND e.status IN ('posted', 'reversed')
     AND e.entry_date BETWEEN p_from AND p_to
   ORDER BY 1, 2;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_ledger_statement(uuid, currency_code, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE purchase_invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments      ENABLE ROW LEVEL SECURITY;

CREATE POLICY pi_select ON purchase_invoices FOR SELECT TO authenticated USING (app_is_office());
CREATE POLICY pi_insert ON purchase_invoices FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY pi_update ON purchase_invoices FOR UPDATE TO authenticated
  USING (app_is_office() AND status = 'draft') WITH CHECK (app_is_office() AND status = 'draft');
CREATE POLICY pi_delete ON purchase_invoices FOR DELETE TO authenticated
  USING (status = 'draft' AND (created_by = auth.uid() OR app_is_admin()));

CREATE POLICY pil_select ON purchase_invoice_lines FOR SELECT TO authenticated USING (app_is_office());
CREATE POLICY pil_write ON purchase_invoice_lines FOR INSERT TO authenticated
  WITH CHECK (app_is_office() AND EXISTS
    (SELECT 1 FROM purchase_invoices i WHERE i.id = invoice_id AND i.status = 'draft'));
CREATE POLICY pil_update ON purchase_invoice_lines FOR UPDATE TO authenticated
  USING (app_is_office() AND EXISTS
    (SELECT 1 FROM purchase_invoices i WHERE i.id = invoice_id AND i.status = 'draft'));
CREATE POLICY pil_delete ON purchase_invoice_lines FOR DELETE TO authenticated
  USING (app_is_office() AND EXISTS
    (SELECT 1 FROM purchase_invoices i WHERE i.id = invoice_id AND i.status = 'draft'));

CREATE POLICY sp_select ON supplier_payments FOR SELECT TO authenticated USING (app_is_office());
CREATE POLICY sp_insert ON supplier_payments FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY sp_update ON supplier_payments FOR UPDATE TO authenticated
  USING (app_is_office() AND status = 'draft') WITH CHECK (app_is_office() AND status = 'draft');
CREATE POLICY sp_delete ON supplier_payments FOR DELETE TO authenticated
  USING (status = 'draft' AND (created_by = auth.uid() OR app_is_admin()));

GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_invoices, purchase_invoice_lines, supplier_payments TO authenticated;

-- audit + touch
SELECT fn_enable_audit(t), fn_enable_touch(t)
  FROM unnest(ARRAY['purchase_invoices', 'purchase_invoice_lines', 'supplier_payments']::regclass[]) AS t;
