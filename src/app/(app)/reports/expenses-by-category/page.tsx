"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { L } from "@/components/L";
import { DateInput, Field } from "@/components/ui/fields";
import { supabase } from "@/lib/supabase/client";
import { monthStartKabul, todayKabul } from "@/lib/dates";
import { fmtMoney, type Currency } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { lblEn } from "@/lib/labels";

interface Row {
  category_name: string;
  category_name_ps: string;
  currency: Currency;
  total: string;
  entry_count: number;
}

export default function ExpensesByCategoryReport() {
  const [from, setFrom] = useState(monthStartKabul());
  const [to, setTo] = useState(todayKabul());

  const { data, isLoading } = useQuery({
    queryKey: ["expense_report", from, to],
    queryFn: async () => {
      const { data, error } = await supabase().rpc("fn_expense_report", { p_from: from, p_to: to });
      if (error) throw error;
      return data as Row[];
    },
  });

  const rows = data ?? [];

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-end gap-3 no-print">
        <span className="font-semibold text-lg"><L k="report_expense_by_category" /></span>
        <Field k="from_date"><DateInput value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field k="to_date"><DateInput value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <button className="btn-secondary ml-auto"
          onClick={() =>
            downloadCsv("expenses-by-category.csv",
              [lblEn("category"), lblEn("currency"), lblEn("total"), lblEn("rows")],
              rows.map((r) => [r.category_name, r.currency, r.total, String(r.entry_count)]))
          }>
          <L k="export_csv" />
        </button>
        <button className="btn-secondary" onClick={() => window.print()}><L k="print" /></button>
      </div>
      <div className="panel">
        <table className="erp-table">
          <thead>
            <tr>
              <th><L k="category" /></th>
              <th><L k="currency" /></th>
              <th className="text-right"><L k="total" /></th>
              <th className="text-right"><L k="rows" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={4} className="text-center py-4 text-ink-faint"><L k="loading" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-4 text-ink-faint"><L k="no_data" /></td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    {r.category_name}{" "}
                    <span dir="rtl" lang="ps" className="font-pashto text-ink-soft">{r.category_name_ps}</span>
                  </td>
                  <td>{r.currency}</td>
                  <td className="num">{fmtMoney(r.total, r.currency)}</td>
                  <td className="num">{r.entry_count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
