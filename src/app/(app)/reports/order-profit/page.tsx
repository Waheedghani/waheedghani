"use client";

/** Profit estimate per order — clearly labeled estimate; rates shown. */
import { useQuery } from "@tanstack/react-query";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { fmtMoney, fmtQty, type Currency } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { lblEn } from "@/lib/labels";

interface Row {
  order_doc_no: string;
  variant_label: string;
  currency: Currency;
  qty_received: string;
  landed_cost_unit: string;
  landed_total: string;
  est_avg_price: string | null;
  est_revenue: string;
  est_profit: string;
  rates_used: string | null;
}

export default function OrderProfitReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["order_profit"],
    queryFn: async () => {
      const { data, error } = await supabase().rpc("fn_order_profit");
      if (error) throw error;
      return data as Row[];
    },
  });

  const rows = data ?? [];

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-center gap-3 no-print">
        <span className="font-semibold text-lg"><L k="report_order_profit" /></span>
        <span className="text-xs text-ink-faint"><L k="estimate_note" /></span>
        <button className="btn-secondary ml-auto"
          onClick={() =>
            downloadCsv("order-profit-estimate.csv",
              [lblEn("order"), lblEn("variant"), lblEn("currency"), lblEn("qty_received"),
               lblEn("final_cost"), lblEn("total"), lblEn("price"), lblEn("amount"), lblEn("exchange_rate")],
              rows.map((r) => [r.order_doc_no, r.variant_label, r.currency, r.qty_received,
                r.landed_cost_unit, r.landed_total, r.est_avg_price ?? "", r.est_profit, r.rates_used ?? ""]))
          }>
          <L k="export_csv" />
        </button>
        <button className="btn-secondary" onClick={() => window.print()}><L k="print" /></button>
      </div>
      <div className="panel overflow-auto">
        <table className="erp-table">
          <thead>
            <tr>
              <th><L k="order" /></th>
              <th><L k="variant" /></th>
              <th className="text-right"><L k="qty_received" /></th>
              <th className="text-right"><L k="final_cost" /></th>
              <th className="text-right"><L k="landed_cost" /> <L k="total" /></th>
              <th className="text-right"><L k="price" /> (est)</th>
              <th className="text-right"><L k="amount" /> (est)</th>
              <th className="text-right font-semibold"><L k="report_order_profit" /></th>
              <th><L k="exchange_rate" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="text-center py-4 text-ink-faint"><L k="loading" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-4 text-ink-faint"><L k="no_data" /></td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.order_doc_no}</td>
                  <td>{r.variant_label}</td>
                  <td className="num">{fmtQty(r.qty_received)}</td>
                  <td className="num">{fmtMoney(r.landed_cost_unit, r.currency, { dp: 6 })}</td>
                  <td className="num">{fmtMoney(r.landed_total, r.currency)}</td>
                  <td className="num">{r.est_avg_price ? fmtMoney(r.est_avg_price, r.currency, { dp: 4 }) : "—"}</td>
                  <td className="num">{fmtMoney(r.est_revenue, r.currency)}</td>
                  <td className="num font-semibold">{fmtMoney(r.est_profit, r.currency)}</td>
                  <td className="text-xs">{r.rates_used ?? ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
