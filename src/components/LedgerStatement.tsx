"use client";

/**
 * Generic party ledger statement over fn_ledger_statement:
 * opening balance row, entries, running balance — per currency, date-filtered.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { L } from "@/components/L";
import { DateInput, Field, CurrencySelect } from "@/components/ui/fields";
import { fmtDate, monthStartKabul, todayKabul } from "@/lib/dates";
import { fmtMoney, type Currency } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { lblEn } from "@/lib/labels";

interface StatementRow {
  entry_date: string;
  entry_no: number | null;
  doc_ref: string | null;
  description: string;
  description_ps: string;
  debit: string | null;
  credit: string | null;
  running_balance: string;
}

export function LedgerStatement({
  accountId,
  defaultCurrency = "AFN",
  exportName,
}: {
  accountId: string;
  defaultCurrency?: Currency;
  exportName: string;
}) {
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [from, setFrom] = useState(monthStartKabul());
  const [to, setTo] = useState(todayKabul());

  const { data, isLoading } = useQuery({
    queryKey: ["ledger", accountId, currency, from, to],
    queryFn: async () => {
      const { data, error } = await supabase().rpc("fn_ledger_statement", {
        p_account_id: accountId,
        p_currency: currency,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return data as StatementRow[];
    },
  });

  const rows = data ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2 no-print">
        <Field k="currency">
          <CurrencySelect value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} />
        </Field>
        <Field k="from_date">
          <DateInput value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field k="to_date">
          <DateInput value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <button
          className="btn-secondary"
          onClick={() =>
            downloadCsv(
              `${exportName}.csv`,
              [lblEn("date"), lblEn("entry_no"), lblEn("description"), lblEn("debit"), lblEn("credit"), lblEn("running_balance")],
              rows.map((r) => [
                r.entry_date, String(r.entry_no ?? ""), r.description,
                r.debit ?? "", r.credit ?? "", r.running_balance,
              ])
            )
          }
        >
          <L k="export_csv" />
        </button>
        <button className="btn-secondary" onClick={() => window.print()}>
          <L k="print" />
        </button>
      </div>

      <table className="erp-table">
        <thead>
          <tr>
            <th className="w-24"><L k="date" /></th>
            <th className="w-20"><L k="entry_no" /></th>
            <th><L k="description" /></th>
            <th className="w-28 text-right"><L k="debit" /></th>
            <th className="w-28 text-right"><L k="credit" /></th>
            <th className="w-32 text-right"><L k="running_balance" /></th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={6} className="text-center text-ink-faint py-4"><L k="loading" /></td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={6} className="text-center text-ink-faint py-4"><L k="no_data" /></td></tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className={r.entry_no === null ? "bg-surface-sunken font-medium" : undefined}>
                <td className="num">{fmtDate(r.entry_date)}</td>
                <td className="num">{r.entry_no ?? ""}</td>
                <td>
                  <span dir="auto">{r.description}</span>{" "}
                  {r.description_ps && (
                    <span dir="rtl" lang="ps" className="font-pashto text-ink-soft">{r.description_ps}</span>
                  )}
                </td>
                <td className="num">{r.debit ? fmtMoney(r.debit, currency) : ""}</td>
                <td className="num">{r.credit ? fmtMoney(r.credit, currency) : ""}</td>
                <td className="num font-medium">{fmtMoney(r.running_balance, currency)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
