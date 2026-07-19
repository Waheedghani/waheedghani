"use client";

/** Keeper dispatches: view own invoices + confirm goods arrival. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { L } from "@/components/L";
import { StatusChip } from "@/components/StatusChip";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useVariants } from "@/lib/lookups";
import { fmtDate } from "@/lib/dates";
import { fmtMoney, fmtQty, type Currency } from "@/lib/money";

interface Dispatch {
  id: string;
  doc_no: string | null;
  dispatch_date: string;
  currency: Currency;
  status: string;
  wh_confirmed_at: string | null;
  dispatch_lines: Array<{ variant_id: string; qty: string; price_per_unit: string; line_total: string }>;
}

export default function PortalDispatchesPage() {
  const qc = useQueryClient();
  const variants = useVariants();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["portal_dispatches"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("dispatch_invoices")
        .select("id, doc_no, dispatch_date, currency, status, wh_confirmed_at, dispatch_lines(variant_id, qty, price_per_unit, line_total)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as unknown as Dispatch[];
    },
  });

  const confirm = useMutation({
    mutationFn: async (dispatchId: string) => {
      const { error } = await supabase().rpc("fn_confirm_dispatch", { p_dispatch_id: dispatchId });
      if (error) throw error;
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["portal_dispatches"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  const variantLabel = (id: string) => (variants.data ?? []).find((v) => v.id === id)?.label ?? "";

  return (
    <div className="space-y-2">
      {error && <div className="text-status-reversed text-xs" dir="auto">{error}</div>}
      {isLoading && <div className="text-ink-faint"><L k="loading" /></div>}
      {(data ?? []).map((d) => (
        <div key={d.id} className="panel">
          <div className="panel-title flex items-center gap-3">
            <span>{d.doc_no}</span>
            <span className="text-ink-soft font-normal">{fmtDate(d.dispatch_date)}</span>
            <StatusChip status={d.status} />
            {d.wh_confirmed_at ? (
              <span className="text-status-posted text-xs ml-auto">
                <L k="received" /> — {fmtDate(d.wh_confirmed_at)}
              </span>
            ) : (
              d.status === "posted" && (
                <button className="btn-primary ml-auto" onClick={() => confirm.mutate(d.id)}>
                  <L k="goods_received_confirm" />
                </button>
              )
            )}
          </div>
          <table className="erp-table">
            <thead>
              <tr>
                <th><L k="variant" /></th>
                <th className="text-right w-28"><L k="quantity" /></th>
                <th className="text-right w-32"><L k="price" /></th>
                <th className="text-right w-32"><L k="total" /></th>
              </tr>
            </thead>
            <tbody>
              {d.dispatch_lines.map((l, i) => (
                <tr key={i}>
                  <td>{variantLabel(l.variant_id)}</td>
                  <td className="num">{fmtQty(l.qty)}</td>
                  <td className="num">{fmtMoney(l.price_per_unit, d.currency)}</td>
                  <td className="num">{fmtMoney(l.line_total, d.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
