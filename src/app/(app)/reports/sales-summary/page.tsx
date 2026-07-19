"use client";

/** Sales/dispatch summary: by product, warehouse, period (server rows,
 *  exact decimal grouping for display). */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { L } from "@/components/L";
import { DateInput, Field } from "@/components/ui/fields";
import { supabase } from "@/lib/supabase/client";
import { monthStartKabul, todayKabul } from "@/lib/dates";
import { D, fmtMoney, fmtQty, sumD, type Currency } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { lblEn } from "@/lib/labels";

interface SalesRow {
  dispatch_date: string;
  warehouse_name: string;
  warehouse_name_ps: string;
  currency: Currency;
  product_name: string;
  variant_label: string;
  qty: string;
  line_total: string;
}

export default function SalesSummaryReport() {
  const [from, setFrom] = useState(monthStartKabul());
  const [to, setTo] = useState(todayKabul());

  const { data, isLoading } = useQuery({
    queryKey: ["sales_rows", from, to],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("v_sales_rows")
        .select("*")
        .gte("dispatch_date", from)
        .lte("dispatch_date", to);
      if (error) throw error;
      return data as SalesRow[];
    },
  });

  const rows = data ?? [];
  const groups = new Map<string, SalesRow[]>();
  for (const r of rows) {
    const key = `${r.product_name} — ${r.variant_label}|${r.warehouse_name}|${r.warehouse_name_ps}|${r.currency}`;
    const g = groups.get(key) ?? [];
    g.push(r);
    groups.set(key, g);
  }
  const grouped = [...groups.entries()].map(([key, g]) => {
    const [variant, warehouse, warehousePs, currency] = key.split("|");
    return {
      variant: variant!,
      warehouse: warehouse!,
      warehousePs: warehousePs!,
      currency: currency as Currency,
      qty: sumD(g.map((x) => x.qty)),
      revenue: sumD(g.map((x) => x.line_total)),
    };
  }).sort((a, b) => a.variant.localeCompare(b.variant) || a.warehouse.localeCompare(b.warehouse));

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-end gap-3 no-print">
        <span className="font-semibold text-lg"><L k="report_sales_summary" /></span>
        <Field k="from_date"><DateInput value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field k="to_date"><DateInput value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <button className="btn-secondary ml-auto"
          onClick={() =>
            downloadCsv("sales-summary.csv",
              [lblEn("variant"), lblEn("warehouse"), lblEn("currency"), lblEn("quantity"), lblEn("total")],
              grouped.map((g) => [g.variant, g.warehouse, g.currency, g.qty.toFixed(3), g.revenue.toFixed(4)]))
          }>
          <L k="export_csv" />
        </button>
        <button className="btn-secondary" onClick={() => window.print()}><L k="print" /></button>
      </div>
      <div className="panel overflow-auto">
        <table className="erp-table">
          <thead>
            <tr>
              <th><L k="variant" /></th>
              <th><L k="warehouse" /></th>
              <th><L k="currency" /></th>
              <th className="text-right"><L k="quantity" /></th>
              <th className="text-right"><L k="total" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="text-center py-4 text-ink-faint"><L k="loading" /></td></tr>
            ) : grouped.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-4 text-ink-faint"><L k="no_data" /></td></tr>
            ) : (
              grouped.map((g, i) => (
                <tr key={i}>
                  <td>{g.variant}</td>
                  <td>
                    {g.warehouse}{" "}
                    <span dir="rtl" lang="ps" className="font-pashto text-ink-soft">{g.warehousePs}</span>
                  </td>
                  <td>{g.currency}</td>
                  <td className="num">{fmtQty(g.qty)}</td>
                  <td className="num">{fmtMoney(g.revenue, g.currency)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}><L k="totals" /> (AFN)</td>
              <td className="num">{fmtQty(grouped.filter((g) => g.currency === "AFN").reduce((a, g) => a.plus(g.qty), D(0)))}</td>
              <td className="num">{fmtMoney(grouped.filter((g) => g.currency === "AFN").reduce((a, g) => a.plus(g.revenue), D(0)), "AFN")}</td>
            </tr>
            <tr>
              <td colSpan={3}><L k="totals" /> (USD)</td>
              <td className="num">{fmtQty(grouped.filter((g) => g.currency === "USD").reduce((a, g) => a.plus(g.qty), D(0)))}</td>
              <td className="num">{fmtMoney(grouped.filter((g) => g.currency === "USD").reduce((a, g) => a.plus(g.revenue), D(0)), "USD")}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
