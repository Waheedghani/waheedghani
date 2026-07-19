"use client";

/** Shared printable party statement (warehouse / saraf): both currencies. */
import { useQuery } from "@tanstack/react-query";
import { Letterhead, SignatureBlocks } from "@/components/print/Letterhead";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { fmtDate, monthStartKabul, todayKabul } from "@/lib/dates";
import { fmtMoney, type Currency } from "@/lib/money";
import type { LabelKey } from "@/lib/labels";

interface StatementRow {
  entry_date: string;
  entry_no: number | null;
  description: string;
  description_ps: string;
  debit: string | null;
  credit: string | null;
  running_balance: string;
}

function CurrencyBlock({ accountId, currency, from, to }: {
  accountId: string; currency: Currency; from: string; to: string;
}) {
  const { data } = useQuery({
    queryKey: ["print_stmt", accountId, currency, from, to],
    queryFn: async () => {
      const { data, error } = await supabase().rpc("fn_ledger_statement", {
        p_account_id: accountId, p_currency: currency, p_from: from, p_to: to,
      });
      if (error) throw error;
      return data as StatementRow[];
    },
  });
  const rows = data ?? [];
  // hide currencies with no activity and a zero opening balance
  if (rows.length <= 1 && rows.every((r) => r.running_balance === "0" || Number(r.running_balance) === 0)) {
    return null;
  }
  return (
    <div className="mb-5">
      <div className="font-semibold border-b border-black mb-1">{currency}</div>
      <table className="erp-table text-[10pt]">
        <thead>
          <tr>
            <th className="w-24"><L k="date" /></th>
            <th className="w-16"><L k="entry_no" /></th>
            <th><L k="description" /></th>
            <th className="w-28 text-right"><L k="debit" /></th>
            <th className="w-28 text-right"><L k="credit" /></th>
            <th className="w-32 text-right"><L k="balance" /></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.entry_no === null ? "font-semibold" : undefined}>
              <td className="num">{fmtDate(r.entry_date)}</td>
              <td className="num">{r.entry_no ?? ""}</td>
              <td>
                <span dir="auto">{r.description}</span>{" "}
                {r.description_ps && <span dir="rtl" lang="ps" className="font-pashto">{r.description_ps}</span>}
              </td>
              <td className="num">{r.debit ? fmtMoney(r.debit) : ""}</td>
              <td className="num">{r.credit ? fmtMoney(r.credit) : ""}</td>
              <td className="num font-medium">{fmtMoney(r.running_balance, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatementPrint({
  titleKey,
  partyName,
  partyNamePs,
  accountId,
  from = monthStartKabul(),
  to = todayKabul(),
}: {
  titleKey: LabelKey;
  partyName: string;
  partyNamePs: string;
  accountId: string;
  from?: string;
  to?: string;
}) {
  return (
    <div>
      <Letterhead titleKey={titleKey} date={to} />
      <div className="flex items-baseline justify-between text-sm mb-3">
        <span className="font-semibold">{partyName}</span>
        <span dir="rtl" lang="ps" className="font-pashto font-semibold">{partyNamePs}</span>
        <span className="num">{fmtDate(from)} — {fmtDate(to)}</span>
      </div>
      <CurrencyBlock accountId={accountId} currency="AFN" from={from} to={to} />
      <CurrencyBlock accountId={accountId} currency="USD" from={from} to={to} />
      <SignatureBlocks />
    </div>
  );
}
