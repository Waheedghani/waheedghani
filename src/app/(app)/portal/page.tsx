"use client";

/** Keeper portal home: own سرای balances + stock summary. RLS-scoped. */
import { useQuery } from "@tanstack/react-query";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { useVariants } from "@/lib/lookups";
import { fmtMoney, fmtQty } from "@/lib/money";
import type { Warehouse } from "@/lib/types";

export default function PortalHome() {
  const { profile } = useAuth();
  const variants = useVariants();
  const whId = profile?.warehouse_id;

  const { data: wh } = useQuery({
    queryKey: ["portal_wh", whId],
    enabled: !!whId,
    queryFn: async () => {
      const { data, error } = await supabase().from("warehouses").select("*").eq("id", whId!).single();
      if (error) throw error;
      return data as Warehouse;
    },
  });

  const { data: stock } = useQuery({
    queryKey: ["portal_stock", whId],
    enabled: !!whId,
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("v_stock_levels")
        .select("*")
        .eq("warehouse_id", whId!);
      if (error) throw error;
      return data as Array<{ variant_id: string; qty: string }>;
    },
  });

  const { data: statement } = useQuery({
    queryKey: ["portal_balance", wh?.account_id],
    enabled: !!wh,
    queryFn: async () => {
      // the keeper reads their balance through the guarded statement function
      const [afn, usd] = await Promise.all([
        supabase().rpc("fn_ledger_statement", {
          p_account_id: wh!.account_id, p_currency: "AFN",
          p_from: "2000-01-01", p_to: "2099-12-31",
        }),
        supabase().rpc("fn_ledger_statement", {
          p_account_id: wh!.account_id, p_currency: "USD",
          p_from: "2000-01-01", p_to: "2099-12-31",
        }),
      ]);
      const last = (rows: unknown): string => {
        const arr = (rows as Array<{ running_balance: string }>) ?? [];
        return arr.length > 0 ? arr[arr.length - 1]!.running_balance : "0";
      };
      return { afn: last(afn.data), usd: last(usd.data) };
    },
  });

  const variantLabel = (id: string) => (variants.data ?? []).find((v) => v.id === id)?.label ?? "";

  if (!wh) return <div className="text-ink-faint"><L k="loading" /></div>;

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-center gap-3">
        <span className="font-semibold text-lg">{wh.name}</span>
        <span dir="rtl" lang="ps" className="font-pashto text-lg">{wh.name_ps}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="panel px-3 py-2">
          <div className="text-xs text-ink-soft"><L k="balance" /> · AFN</div>
          <div className="text-xl font-semibold num">{fmtMoney(statement?.afn ?? "0", "AFN")}</div>
        </div>
        <div className="panel px-3 py-2">
          <div className="text-xs text-ink-soft"><L k="balance" /> · USD</div>
          <div className="text-xl font-semibold num">{fmtMoney(statement?.usd ?? "0", "USD")}</div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-title"><L k="stock" /></div>
        <table className="erp-table">
          <thead>
            <tr><th><L k="variant" /></th><th className="text-right w-32"><L k="quantity" /></th></tr>
          </thead>
          <tbody>
            {(stock ?? []).map((s) => (
              <tr key={s.variant_id}>
                <td>{variantLabel(s.variant_id)}</td>
                <td className="num">{fmtQty(s.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
