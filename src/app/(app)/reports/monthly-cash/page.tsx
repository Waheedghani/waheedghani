"use client";

/** Monthly cash summary: per-day drawer in/out/closing (AFN & USD). */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { L } from "@/components/L";
import { StatusChip } from "@/components/StatusChip";
import { supabase } from "@/lib/supabase/client";
import { fmtDate, todayKabul } from "@/lib/dates";
import { fmtMoney } from "@/lib/money";

interface Row {
  day_date: string;
  afn_in: string; afn_out: string; afn_close: string;
  usd_in: string; usd_out: string; usd_close: string;
  day_status: string;
}

export default function MonthlyCashReport() {
  const today = todayKabul();
  const [year, setYear] = useState(Number.parseInt(today.slice(0, 4), 10));
  const [month, setMonth] = useState(Number.parseInt(today.slice(5, 7), 10));

  const { data, isLoading } = useQuery({
    queryKey: ["monthly_cash", year, month],
    queryFn: async () => {
      const { data, error } = await supabase().rpc("fn_monthly_cash_summary", {
        p_year: year, p_month: month,
      });
      if (error) throw error;
      return data as Row[];
    },
  });

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-center gap-3 no-print">
        <span className="font-semibold text-lg"><L k="report_monthly_cash" /></span>
        <input type="number" className="input w-20 num" value={year}
          onChange={(e) => setYear(Number.parseInt(e.target.value || "2026", 10))} />
        <input type="number" min={1} max={12} className="input w-16 num" value={month}
          onChange={(e) => setMonth(Number.parseInt(e.target.value || "1", 10))} />
        <button className="btn-secondary ml-auto" onClick={() => window.print()}><L k="print" /></button>
      </div>
      <div className="panel overflow-auto">
        <table className="erp-table">
          <thead>
            <tr>
              <th><L k="date" /></th>
              <th className="text-right">AFN <L k="cash_in" /></th>
              <th className="text-right">AFN <L k="cash_out" /></th>
              <th className="text-right">AFN <L k="closing_balance" /></th>
              <th className="text-right">USD <L k="cash_in" /></th>
              <th className="text-right">USD <L k="cash_out" /></th>
              <th className="text-right">USD <L k="closing_balance" /></th>
              <th><L k="status" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="text-center py-4 text-ink-faint"><L k="loading" /></td></tr>
            ) : (
              (data ?? []).map((r) => (
                <tr key={r.day_date}>
                  <td className="num">{fmtDate(r.day_date)}</td>
                  <td className="num">{fmtMoney(r.afn_in, undefined, { blankZero: true })}</td>
                  <td className="num">{fmtMoney(r.afn_out, undefined, { blankZero: true })}</td>
                  <td className="num font-medium">{fmtMoney(r.afn_close, "AFN")}</td>
                  <td className="num">{fmtMoney(r.usd_in, undefined, { blankZero: true })}</td>
                  <td className="num">{fmtMoney(r.usd_out, undefined, { blankZero: true })}</td>
                  <td className="num font-medium">{fmtMoney(r.usd_close, "USD")}</td>
                  <td><StatusChip status={r.day_status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
