"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { L } from "@/components/L";
import { fmtMoney, sumD, type Currency } from "@/lib/money";
import { fmtDateTime } from "@/lib/dates";

interface BalRow {
  code: string;
  currency: Currency;
  balance: string;
}

/**
 * Home: dense operational summary — drawer cash, receivables, quick links.
 * Numbers come straight from v_account_balances (server-computed).
 */
export default function HomePage() {
  const { data: balances } = useQuery({
    queryKey: ["home-balances"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("v_account_balances")
        .select("code, currency, balance")
        .in("code", ["1000", "1001"]);
      if (error) throw error;
      return (data ?? []) as BalRow[];
    },
  });

  const { data: recv } = useQuery({
    queryKey: ["home-receivables"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("v_account_balances")
        .select("currency, balance, type")
        .eq("type", "warehouse_receivable");
      if (error) throw error;
      return (data ?? []) as Array<{ currency: Currency; balance: string }>;
    },
  });

  const drawerAfn = balances?.find((b) => b.code === "1000")?.balance ?? "0";
  const drawerUsd = balances?.find((b) => b.code === "1001")?.balance ?? "0";
  const recvAfn = sumD((recv ?? []).filter((r) => r.currency === "AFN").map((r) => r.balance));
  const recvUsd = sumD((recv ?? []).filter((r) => r.currency === "USD").map((r) => r.balance));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <SummaryCell labelKey="drawer" sub="AFN" value={fmtMoney(drawerAfn, "AFN")} />
        <SummaryCell labelKey="drawer" sub="USD" value={fmtMoney(drawerUsd, "USD")} />
        <SummaryCell labelKey="balance" sub="Receivables AFN" value={fmtMoney(recvAfn, "AFN")} />
        <SummaryCell labelKey="balance" sub="Receivables USD" value={fmtMoney(recvUsd, "USD")} />
      </div>

      <div className="panel">
        <div className="panel-title">
          <L k="actions" />
        </div>
        <div className="p-3 grid grid-cols-2 md:grid-cols-5 gap-2">
          <Link href="/purchasing/invoices/new" className="btn-secondary justify-center">
            <L k="purchase_invoices" />
          </Link>
          <Link href="/warehouses/dispatches/new" className="btn-secondary justify-center">
            <L k="dispatch" />
          </Link>
          <Link href="/warehouses/payments/new" className="btn-secondary justify-center">
            <L k="payment" />
          </Link>
          <Link href="/roznamcha" className="btn-secondary justify-center">
            <L k="roznamcha" />
          </Link>
          <Link href="/reports" className="btn-secondary justify-center">
            <L k="reports" />
          </Link>
        </div>
      </div>

      <div className="text-xs text-ink-faint">
        {fmtDateTime(new Date())} — Asia/Kabul
      </div>
    </div>
  );
}

function SummaryCell({
  labelKey,
  sub,
  value,
}: {
  labelKey: "drawer" | "balance";
  sub: string;
  value: string;
}) {
  return (
    <div className="panel px-3 py-2">
      <div className="text-xs text-ink-soft">
        <L k={labelKey} /> · {sub}
      </div>
      <div className="text-xl font-semibold num">{value}</div>
    </div>
  );
}
