"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { L } from "@/components/L";
import { DateInput, Field } from "@/components/ui/fields";
import { supabase } from "@/lib/supabase/client";
import { todayKabul } from "@/lib/dates";
import { fmtMoney, sumD, type Currency } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { lblEn } from "@/lib/labels";

interface Row {
  warehouse_id: string;
  warehouse_name: string;
  warehouse_name_ps: string;
  currency: Currency;
  bucket_0_7: string;
  bucket_8_30: string;
  bucket_31_plus: string;
  total: string;
}

export default function ReceivablesAgingReport() {
  const [asOf, setAsOf] = useState(todayKabul());

  const { data, isLoading } = useQuery({
    queryKey: ["aging", asOf],
    queryFn: async () => {
      const { data, error } = await supabase().rpc("fn_receivables_aging", { p_as_of: asOf });
      if (error) throw error;
      return data as Row[];
    },
  });

  const rows = data ?? [];

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-end gap-3 no-print">
        <span className="font-semibold text-lg"><L k="report_receivables_aging" /></span>
        <Field k="date"><DateInput value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <button className="btn-secondary ml-auto"
          onClick={() =>
            downloadCsv("receivables-aging.csv",
              [lblEn("warehouse"), lblEn("currency"), lblEn("days_0_7"), lblEn("days_8_30"), lblEn("days_31_plus"), lblEn("total")],
              rows.map((r) => [r.warehouse_name, r.currency, r.bucket_0_7, r.bucket_8_30, r.bucket_31_plus, r.total]))
          }>
          <L k="export_csv" />
        </button>
        <button className="btn-secondary" onClick={() => window.print()}><L k="print" /></button>
      </div>
      <div className="panel">
        <table className="erp-table">
          <thead>
            <tr>
              <th><L k="warehouse" /></th>
              <th><L k="currency" /></th>
              <th className="text-right"><L k="days_0_7" /></th>
              <th className="text-right"><L k="days_8_30" /></th>
              <th className="text-right"><L k="days_31_plus" /></th>
              <th className="text-right"><L k="total" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="text-center py-4 text-ink-faint"><L k="loading" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-4 text-ink-faint"><L k="no_data" /></td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    {r.warehouse_name}{" "}
                    <span dir="rtl" lang="ps" className="font-pashto text-ink-soft">{r.warehouse_name_ps}</span>
                  </td>
                  <td>{r.currency}</td>
                  <td className="num">{fmtMoney(r.bucket_0_7)}</td>
                  <td className="num">{fmtMoney(r.bucket_8_30)}</td>
                  <td className="num">{fmtMoney(r.bucket_31_plus)}</td>
                  <td className="num font-semibold">{fmtMoney(r.total, r.currency)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}><L k="totals" /> (AFN)</td>
              <td className="num">{fmtMoney(sumD(rows.filter((r) => r.currency === "AFN").map((r) => r.total)), "AFN")}</td>
            </tr>
            <tr>
              <td colSpan={5}><L k="totals" /> (USD)</td>
              <td className="num">{fmtMoney(sumD(rows.filter((r) => r.currency === "USD").map((r) => r.total)), "USD")}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
