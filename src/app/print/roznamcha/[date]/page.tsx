"use client";

/** Printable Roznamcha daily sheet (A4, B/W): opening balances, all entries
 *  with bill refs, totals in/out, closing balances, variance, signatures. */
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { Letterhead, SignatureBlocks } from "@/components/print/Letterhead";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { fmtMoney } from "@/lib/money";

interface SheetRow {
  row_kind: "opening" | "entry" | "closing";
  entry_no: number | null;
  description: string;
  description_ps: string;
  bill_refs: string;
  afn_in: string | null;
  afn_out: string | null;
  usd_in: string | null;
  usd_out: string | null;
  run_afn: string;
  run_usd: string;
}

export default function PrintRoznamchaPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);

  const { data: rows } = useQuery({
    queryKey: ["print_roznamcha", date],
    queryFn: async () => {
      const { data, error } = await supabase().rpc("fn_roznamcha_sheet", { p_date: date });
      if (error) throw error;
      return data as SheetRow[];
    },
  });

  const { data: day } = useQuery({
    queryKey: ["print_roznamcha_day", date],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("roznamcha_days").select("*").eq("day_date", date).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (!rows) return <div className="text-ink-faint"><L k="loading" /></div>;

  return (
    <div>
      <Letterhead titleKey="report_roznamcha_daily" date={date} />
      <table className="erp-table text-[10pt]">
        <thead>
          <tr>
            <th className="w-12"><L k="entry_no" /></th>
            <th><L k="description" /></th>
            <th className="w-24"><L k="bill_refs" /></th>
            <th className="w-24 text-right">AFN <L k="cash_in" /></th>
            <th className="w-24 text-right">AFN <L k="cash_out" /></th>
            <th className="w-24 text-right">AFN <L k="balance" /></th>
            <th className="w-24 text-right">USD <L k="cash_in" /></th>
            <th className="w-24 text-right">USD <L k="cash_out" /></th>
            <th className="w-24 text-right">USD <L k="balance" /></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.row_kind !== "entry" ? "font-semibold" : undefined}>
              <td className="num">{r.entry_no ?? ""}</td>
              <td>
                <span dir="auto">{r.description}</span>{" "}
                {r.description_ps && (
                  <span dir="rtl" lang="ps" className="font-pashto">{r.description_ps}</span>
                )}
              </td>
              <td dir="auto" className="text-[9pt]">{r.bill_refs}</td>
              <td className="num">{r.afn_in ? fmtMoney(r.afn_in) : ""}</td>
              <td className="num">{r.afn_out ? fmtMoney(r.afn_out) : ""}</td>
              <td className="num">{fmtMoney(r.run_afn)}</td>
              <td className="num">{r.usd_in ? fmtMoney(r.usd_in) : ""}</td>
              <td className="num">{r.usd_out ? fmtMoney(r.usd_out) : ""}</td>
              <td className="num">{fmtMoney(r.run_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {day && (
        <div className="mt-4 text-sm border border-black p-2">
          <div className="grid grid-cols-3 gap-2">
            <div><L k="counted" /> AFN: <span className="num font-semibold">{fmtMoney(day.counted_afn)}</span></div>
            <div><L k="computed" /> AFN: <span className="num font-semibold">{fmtMoney(day.computed_afn)}</span></div>
            <div><L k="variance" /> AFN: <span className="num font-semibold">{fmtMoney(day.variance_afn)}</span></div>
            <div><L k="counted" /> USD: <span className="num font-semibold">{fmtMoney(day.counted_usd)}</span></div>
            <div><L k="computed" /> USD: <span className="num font-semibold">{fmtMoney(day.computed_usd)}</span></div>
            <div><L k="variance" /> USD: <span className="num font-semibold">{fmtMoney(day.variance_usd)}</span></div>
          </div>
          {day.variance_explanation && (
            <div className="mt-1" dir="auto">
              <L k="variance_explanation" />: {day.variance_explanation}
            </div>
          )}
        </div>
      )}

      <SignatureBlocks />
    </div>
  );
}
