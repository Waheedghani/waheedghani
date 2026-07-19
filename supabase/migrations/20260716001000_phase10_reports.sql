-- ============================================================================
-- SARAI ERP — Phase 10: Report queries
-- All report computation stays in Postgres; the client only renders.
-- ============================================================================

-- Sales / dispatch summary rows (posted dispatches only)
CREATE OR REPLACE VIEW v_sales_rows WITH (security_invoker = true) AS
SELECT d.id            AS dispatch_id,
       d.doc_no,
       d.dispatch_date,
       d.warehouse_id,
       w.name          AS warehouse_name,
       w.name_ps       AS warehouse_name_ps,
       d.currency,
       d.fx_rate,
       dl.variant_id,
       pv.label        AS variant_label,
       p.category      AS product_category,
       p.name          AS product_name,
       dl.qty,
       dl.price_per_unit,
       dl.line_total
  FROM dispatch_invoices d
  JOIN warehouses w        ON w.id = d.warehouse_id
  JOIN dispatch_lines dl   ON dl.dispatch_id = d.id
  JOIN product_variants pv ON pv.id = dl.variant_id
  JOIN products p          ON p.id = pv.product_id
 WHERE d.status = 'posted';

GRANT SELECT ON v_sales_rows TO authenticated;

-- Expense report by category (posted, date-filtered, per currency)
CREATE OR REPLACE FUNCTION fn_expense_report(p_from date, p_to date)
RETURNS TABLE (
  category_name    text,
  category_name_ps text,
  currency         currency_code,
  total            numeric,
  entry_count      bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ec.name, ec.name_ps, oe.currency, sum(oe.amount), count(*)
    FROM office_expenses oe
    JOIN expense_categories ec ON ec.id = oe.category_id
   WHERE oe.status = 'posted'
     AND oe.expense_date BETWEEN p_from AND p_to
     AND app_is_office()
   GROUP BY ec.name, ec.name_ps, oe.currency
   ORDER BY ec.name, oe.currency;
$$;

GRANT EXECUTE ON FUNCTION fn_expense_report(date, date) TO authenticated;

-- Monthly cash summary: per-day drawer in/out/closing for both currencies
CREATE OR REPLACE FUNCTION fn_monthly_cash_summary(p_year int, p_month int)
RETURNS TABLE (
  day_date date,
  afn_in numeric, afn_out numeric, afn_close numeric,
  usd_in numeric, usd_out numeric, usd_close numeric,
  day_status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_start date := make_date(p_year, p_month, 1);
  v_end   date := (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date;
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  WITH days AS (
    SELECT generate_series(v_start, v_end, interval '1 day')::date AS d
  ),
  cash AS (
    SELECT e.entry_date AS d,
           sum(CASE WHEN l.currency = 'AFN' THEN l.debit  ELSE 0 END) AS a_in,
           sum(CASE WHEN l.currency = 'AFN' THEN l.credit ELSE 0 END) AS a_out,
           sum(CASE WHEN l.currency = 'USD' THEN l.debit  ELSE 0 END) AS u_in,
           sum(CASE WHEN l.currency = 'USD' THEN l.credit ELSE 0 END) AS u_out
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id AND e.status IN ('posted', 'reversed')
      JOIN accounts a ON a.id = l.account_id AND a.type = 'cash'
     WHERE e.entry_date BETWEEN v_start AND v_end
     GROUP BY e.entry_date
  )
  SELECT dd.d,
         coalesce(c.a_in, 0), coalesce(c.a_out, 0),
         fn_account_balance((SELECT id FROM accounts WHERE code = '1000'), 'AFN', dd.d),
         coalesce(c.u_in, 0), coalesce(c.u_out, 0),
         fn_account_balance((SELECT id FROM accounts WHERE code = '1001'), 'USD', dd.d),
         coalesce((SELECT rd.status FROM roznamcha_days rd WHERE rd.day_date = dd.d), 'open')
    FROM days dd
    LEFT JOIN cash c ON c.d = dd.d
   ORDER BY dd.d;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_monthly_cash_summary(int, int) TO authenticated;

-- Profit ESTIMATE per order (spec report 11): dispatch revenue is averaged
-- per variant, converted to the order currency with each dispatch's recorded
-- manual rate. Clearly an estimate; rates used are listed.
CREATE OR REPLACE FUNCTION fn_order_profit()
RETURNS TABLE (
  order_doc_no     text,
  variant_label    text,
  currency         currency_code,
  qty_received     numeric,
  landed_cost_unit numeric,
  landed_total     numeric,
  est_avg_price    numeric,
  est_revenue      numeric,
  est_profit       numeric,
  rates_used       text,
  is_estimate      boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT app_is_office() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT o.doc_no,
         pv.label,
         lc.currency,
         os.qty_received,
         lc.final_cost_per_unit,
         round(lc.final_cost_per_unit * os.qty_received, 4),
         rev.avg_price,
         round(coalesce(rev.avg_price, 0) * os.qty_received, 4),
         round(coalesce(rev.avg_price, 0) * os.qty_received, 4)
           - round(lc.final_cost_per_unit * os.qty_received, 4),
         rev.rates,
         true
    FROM orders o
    JOIN v_order_status os ON os.id = o.id
    JOIN landed_costs lc ON lc.order_id = o.id
    JOIN product_variants pv ON pv.id = o.variant_id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN sum(s.qty) > 0
               THEN round(sum(
                      CASE WHEN s.currency = lc.currency THEN s.line_total
                           ELSE fn_convert_currency(s.line_total, s.currency, lc.currency, s.fx_rate) END
                    ) / sum(s.qty), 6)
             END AS avg_price,
             string_agg(DISTINCT CASE WHEN s.currency <> lc.currency
               THEN s.currency || '@' || coalesce(s.fx_rate::text, '?') END, ', ') AS rates
        FROM v_sales_rows s
       WHERE s.variant_id = o.variant_id
         AND (s.currency = lc.currency OR s.fx_rate IS NOT NULL)
    ) rev ON true
   WHERE os.qty_received > 0
   ORDER BY o.doc_no;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_order_profit() TO authenticated;
