"use client";

/** Landed cost report: full per-order cost buildup from the calc snapshot. */
import { useQuery } from "@tanstack/react-query";
import { L } from "@/components/L";
import { StatusChip } from "@/components/StatusChip";
import { supabase } from "@/lib/supabase/client";
import { fmtMoney, fmtQty, type Currency } from "@/lib/money";
import { fmtDateTime } from "@/lib/dates";

interface Snapshot {
  invoice_unit_cost?: string | number;
  expected_units?: string | number;
  waste_units?: string | number;
  denominator?: string | number;
  expenses_converted_total?: string | number;
  expenses?: Array<{ category: string; description: string; currency: Currency; amount: string; fx_rate: string | null; converted: string }>;
  manual_override?: string | number;
  formula?: string;
}

interface Row {
  id: string;
  order_id: string;
  auto_cost_per_unit: string;
  final_cost_per_unit: string;
  currency: Currency;
  calc_snapshot: Snapshot;
  locked_at: string | null;
  orders: { doc_no: string };
}

export default function LandedCostReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["landed_cost_report"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("landed_costs")
        .select("*, orders(doc_no)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Row[];
    },
  });

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-center gap-3 no-print">
        <span className="font-semibold text-lg"><L k="report_landed_cost" /></span>
        <span className="text-xs text-ink-faint"><L k="waste_absorbed_note" /></span>
        <button className="btn-secondary ml-auto" onClick={() => window.print()}><L k="print" /></button>
      </div>
      {isLoading && <div className="text-ink-faint"><L k="loading" /></div>}
      {(data ?? []).map((r) => {
        const s = r.calc_snapshot ?? {};
        return (
          <div key={r.id} className="panel">
            <div className="panel-title flex items-center gap-3">
              <span>{r.orders?.doc_no}</span>
              {r.locked_at && <StatusChip status="closed" />}
              <span className="ml-auto font-normal text-xs text-ink-soft">
                <L k="final_cost" />: <span className="num font-semibold text-ink">{fmtMoney(r.final_cost_per_unit, r.currency, { dp: 6 })}</span>
              </span>
            </div>
            <div className="p-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              <div><div className="text-ink-soft"><L k="price_per_unit" /></div><div className="num">{fmtMoney(s.invoice_unit_cost ?? "", r.currency, { dp: 4 })}</div></div>
              <div><div className="text-ink-soft"><L k="qty_expected" /></div><div className="num">{fmtQty(String(s.expected_units ?? ""))}</div></div>
              <div><div className="text-ink-soft"><L k="waste" /></div><div className="num">{fmtQty(String(s.waste_units ?? ""))}</div></div>
              <div><div className="text-ink-soft"><L k="expenses" /></div><div className="num">{fmtMoney(s.expenses_converted_total ?? "", r.currency)}</div></div>
              <div><div className="text-ink-soft"><L k="auto_cost" /></div><div className="num">{fmtMoney(r.auto_cost_per_unit, r.currency, { dp: 6 })}</div></div>
            </div>
            {(s.expenses ?? []).length > 0 && (
              <table className="erp-table">
                <thead>
                  <tr>
                    <th><L k="category" /></th><th><L k="description" /></th>
                    <th><L k="currency" /></th><th className="text-right"><L k="amount" /></th>
                    <th className="text-right"><L k="fx_rate" /></th>
                    <th className="text-right"><L k="total" /> ({r.currency})</th>
                  </tr>
                </thead>
                <tbody>
                  {(s.expenses ?? []).map((e, i) => (
                    <tr key={i}>
                      <td>{e.category}</td>
                      <td dir="auto">{e.description}</td>
                      <td>{e.currency}</td>
                      <td className="num">{fmtMoney(e.amount, e.currency)}</td>
                      <td className="num">{e.fx_rate ?? ""}</td>
                      <td className="num">{fmtMoney(e.converted, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {r.locked_at && (
              <div className="px-3 py-1 text-xs text-ink-faint">
                <L k="locked" /> — {fmtDateTime(r.locked_at)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
