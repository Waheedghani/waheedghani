"use client";

/**
 * Warehouse account screen (spec §10.6):
 * Overview | Money Ledger | Stock | Dispatches | Payments | Reconciliation | History
 */
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { L } from "@/components/L";
import { StatusChip } from "@/components/StatusChip";
import { LedgerStatement } from "@/components/LedgerStatement";
import { HistoryDrawer } from "@/components/ui/HistoryDrawer";
import { supabase } from "@/lib/supabase/client";
import { useVariants } from "@/lib/lookups";
import { useAuth } from "@/components/AuthProvider";
import { fmtDate } from "@/lib/dates";
import { fmtMoney, fmtQty, type Currency } from "@/lib/money";
import { lbl, type LabelKey } from "@/lib/labels";
import type { Warehouse } from "@/lib/types";

const TABS: Array<{ id: string; k: LabelKey }> = [
  { id: "overview", k: "overview" },
  { id: "money", k: "money_ledger" },
  { id: "stock", k: "stock" },
  { id: "dispatches", k: "dispatches" },
  { id: "payments", k: "payments" },
  { id: "reconciliation", k: "reconciliation" },
  { id: "history", k: "history" },
];

export default function WarehousePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { profile } = useAuth();
  const variants = useVariants();
  const [tab, setTab] = useState("overview");

  const { data: wh } = useQuery({
    queryKey: ["warehouse", id],
    queryFn: async () => {
      const { data, error } = await supabase().from("warehouses").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Warehouse;
    },
  });

  const { data: overview } = useQuery({
    queryKey: ["warehouse_overview", id],
    enabled: !!wh,
    queryFn: async () => {
      const sb = supabase();
      const [bal, stock, lastPay, aging] = await Promise.all([
        sb.from("v_account_balances").select("currency, balance").eq("account_id", wh!.account_id),
        sb.from("v_stock_levels").select("variant_id, qty").eq("warehouse_id", id),
        sb.from("warehouse_payments").select("payment_date, currency, amount, doc_no")
          .eq("warehouse_id", id).eq("status", "posted")
          .order("payment_date", { ascending: false }).limit(1),
        sb.rpc("fn_receivables_aging", {}),
      ]);
      return {
        balances: (bal.data ?? []) as Array<{ currency: Currency; balance: string }>,
        stock: (stock.data ?? []) as Array<{ variant_id: string; qty: string }>,
        lastPayment: lastPay.data?.[0] as { payment_date: string; currency: Currency; amount: string; doc_no: string } | undefined,
        aging: ((aging.data ?? []) as Array<Record<string, unknown>>).filter((a) => a.warehouse_id === id),
      };
    },
  });

  const { data: dispatches } = useQuery({
    queryKey: ["warehouse_dispatches", id],
    enabled: tab === "dispatches",
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("dispatch_invoices")
        .select("id, doc_no, dispatch_date, currency, status, wh_confirmed_at, dispatch_lines(line_total)")
        .eq("warehouse_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Array<Record<string, unknown>>;
    },
  });

  const { data: payments } = useQuery({
    queryKey: ["warehouse_payments_tab", id],
    enabled: tab === "payments",
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("warehouse_payments")
        .select("*")
        .eq("warehouse_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Array<Record<string, unknown>>;
    },
  });

  const { data: recons } = useQuery({
    queryKey: ["warehouse_recons", id],
    enabled: tab === "reconciliation",
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("reconciliations")
        .select("*")
        .eq("party_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Array<Record<string, unknown>>;
    },
  });

  if (!wh) return <div className="text-ink-faint"><L k="loading" /></div>;

  const variantLabel = (vid: string) => (variants.data ?? []).find((v) => v.id === vid)?.label ?? "";
  const afn = overview?.balances.find((b) => b.currency === "AFN")?.balance ?? "0";
  const usd = overview?.balances.find((b) => b.currency === "USD")?.balance ?? "0";

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-center gap-3">
        <span className="font-semibold text-lg">{wh.name}</span>
        <span dir="rtl" lang="ps" className="font-pashto text-lg">{wh.name_ps}</span>
        <span className="text-ink-soft text-xs">{wh.keeper_name} · {wh.phone}</span>
        <StatusChip status={wh.is_active ? "posted" : "draft"} />
      </div>

      <div className="flex gap-0 border-b border-line no-print">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`px-3 py-1.5 border-b-2 -mb-px ${tab === t.id ? "border-accent text-accent font-medium" : "border-transparent text-ink-soft hover:text-ink"}`}
            onClick={() => setTab(t.id)}
          >
            <L k={t.k} />
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Cell k="balance" sub="AFN" v={fmtMoney(afn, "AFN")} />
            <Cell k="balance" sub="USD" v={fmtMoney(usd, "USD")} />
            <Cell
              k="last_payment"
              sub={overview?.lastPayment?.doc_no ?? ""}
              v={overview?.lastPayment
                ? `${fmtMoney(overview.lastPayment.amount, overview.lastPayment.currency)} · ${fmtDate(overview.lastPayment.payment_date)}`
                : "—"}
            />
            <div className="panel px-3 py-2">
              <div className="text-xs text-ink-soft"><L k="aging" /></div>
              {(overview?.aging ?? []).map((a, i) => (
                <div key={i} className="text-xs num">
                  {String(a.currency)}: 0–7 {fmtMoney(String(a.bucket_0_7))} · 8–30 {fmtMoney(String(a.bucket_8_30))} · 31+ {fmtMoney(String(a.bucket_31_plus))}
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-title"><L k="stock" /></div>
            <table className="erp-table">
              <thead>
                <tr><th><L k="variant" /></th><th className="text-right w-32"><L k="quantity" /></th></tr>
              </thead>
              <tbody>
                {(overview?.stock ?? []).map((s) => (
                  <tr key={s.variant_id}>
                    <td>{variantLabel(s.variant_id)}</td>
                    <td className="num">{fmtQty(s.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "money" && (
        <LedgerStatement accountId={wh.account_id} exportName={`warehouse-${wh.name}-ledger`} />
      )}

      {tab === "stock" && (
        <div className="panel">
          <div className="panel-title"><L k="stock_ledger" /></div>
          <StockMovements warehouseId={id} variantLabel={variantLabel} />
        </div>
      )}

      {tab === "dispatches" && (
        <table className="erp-table panel">
          <thead>
            <tr>
              <th><L k="doc_no" /></th><th><L k="date" /></th><th><L k="currency" /></th>
              <th><L k="status" /></th><th><L k="goods_received_confirm" /></th>
            </tr>
          </thead>
          <tbody>
            {(dispatches ?? []).map((d) => (
              <tr key={String(d.id)} className="cursor-pointer"
                onDoubleClick={() => router.push(`/warehouses/dispatches/${d.id}`)}>
                <td>{String(d.doc_no ?? `(${lbl("draft")})`)}</td>
                <td className="num">{fmtDate(String(d.dispatch_date))}</td>
                <td>{String(d.currency)}</td>
                <td><StatusChip status={String(d.status)} /></td>
                <td>{d.wh_confirmed_at ? fmtDate(String(d.wh_confirmed_at)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "payments" && (
        <table className="erp-table panel">
          <thead>
            <tr>
              <th><L k="doc_no" /></th><th><L k="date" /></th><th><L k="method" /></th>
              <th><L k="hawala_no" /></th><th className="text-right"><L k="amount" /></th><th><L k="status" /></th>
            </tr>
          </thead>
          <tbody>
            {(payments ?? []).map((p) => (
              <tr key={String(p.id)}>
                <td>{String(p.doc_no ?? `(${lbl("draft")})`)}</td>
                <td className="num">{fmtDate(String(p.payment_date))}</td>
                <td>{String(p.method)}</td>
                <td>{String(p.hawala_number ?? "")}</td>
                <td className="num">{fmtMoney(String(p.amount), p.currency as Currency)}</td>
                <td><StatusChip status={String(p.status)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "reconciliation" && (
        <table className="erp-table panel">
          <thead>
            <tr>
              <th><L k="date" /></th><th><L k="kind" /></th>
              <th><L k="system_balance" /></th><th><L k="external_balance" /></th>
              <th><L k="variance" /></th><th><L k="status" /></th>
            </tr>
          </thead>
          <tbody>
            {(recons ?? []).map((r) => (
              <tr key={String(r.id)}>
                <td className="num">{fmtDate(String(r.period_end))}</td>
                <td>{String(r.rtype)}</td>
                <td className="font-mono text-xs">{JSON.stringify(r.system_balance)}</td>
                <td className="font-mono text-xs">{JSON.stringify(r.external_balance)}</td>
                <td className="font-mono text-xs">{JSON.stringify(r.variance)}</td>
                <td><StatusChip status={String(r.status)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "history" && profile?.role === "admin" && (
        <HistoryInline table="warehouses" pk={id} />
      )}
    </div>
  );
}

function Cell({ k, sub, v }: { k: LabelKey; sub: string; v: string }) {
  return (
    <div className="panel px-3 py-2">
      <div className="text-xs text-ink-soft"><L k={k} /> {sub && `· ${sub}`}</div>
      <div className="font-semibold num text-lg">{v}</div>
    </div>
  );
}

function StockMovements({ warehouseId, variantLabel }: { warehouseId: string; variantLabel: (id: string) => string }) {
  const { data } = useQuery({
    queryKey: ["stock_movements", warehouseId],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("stock_movements")
        .select("*")
        .eq("warehouse_id", warehouseId)
        .order("seq", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as Array<Record<string, unknown>>;
    },
  });
  return (
    <table className="erp-table">
      <thead>
        <tr>
          <th><L k="date" /></th><th><L k="variant" /></th>
          <th><L k="movement_type" /></th><th className="text-right"><L k="quantity" /></th><th><L k="note" /></th>
        </tr>
      </thead>
      <tbody>
        {(data ?? []).map((m) => (
          <tr key={String(m.id)}>
            <td className="num">{fmtDate(String(m.movement_date))}</td>
            <td>{variantLabel(String(m.variant_id))}</td>
            <td>{String(m.movement_type)}</td>
            <td className="num">{fmtQty(String(m.qty))}</td>
            <td dir="auto">{String(m.notes ?? "")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HistoryInline({ table, pk }: { table: string; pk: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return <HistoryDrawer table={table} pk={pk} onClose={() => setOpen(false)} />;
}
