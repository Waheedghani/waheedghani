"use client";

import { lbl } from "@/lib/labels";
/**
 * Reconciliation (spec §7.2): saraf money, warehouse money, warehouse stock
 * counts — create, review variance, resolve with documented explanation
 * (admin), optional adjustment posting for money variances.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { L } from "@/components/L";
import { StatusChip } from "@/components/StatusChip";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AmountInput, DateInput, Field, FieldGrid, Select, TextInput } from "@/components/ui/fields";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useSarafs, useVariants, useWarehouses } from "@/lib/lookups";
import { useAuth } from "@/components/AuthProvider";
import { fmtDate, todayKabul } from "@/lib/dates";
import { D, parseAmount, toMoneyString, toQtyString } from "@/lib/money";

interface Recon {
  id: string;
  rtype: string;
  party_id: string;
  period_end: string;
  system_balance: Record<string, string>;
  external_balance: Record<string, string>;
  variance: Record<string, string>;
  adjustment_entry_id: string | null;
  status: string;
  notes: string | null;
}

export default function ReconciliationPage() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const sarafs = useSarafs();
  const warehouses = useWarehouses();
  const variants = useVariants();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"money" | "stock" | null>(null);
  const [resolveTarget, setResolveTarget] = useState<{ recon: Recon; adjust: boolean } | null>(null);

  const [moneyForm, setMoneyForm] = useState({
    rtype: "saraf" as "saraf" | "warehouse_money",
    party_id: "",
    period_end: todayKabul(),
    stated_afn: "0",
    stated_usd: "0",
    notes: "",
  });
  const [stockForm, setStockForm] = useState({
    warehouse_id: "",
    counts: [] as Array<{ variant_id: string; counted: string }>,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["reconciliations"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("reconciliations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as Recon[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["reconciliations"] });

  const createMoney = useMutation({
    mutationFn: async () => {
      const { error } = await supabase().rpc("fn_reconcile_money", {
        p_rtype: moneyForm.rtype,
        p_party_id: moneyForm.party_id,
        p_period_end: moneyForm.period_end,
        p_stated_afn: toMoneyString(parseAmount(moneyForm.stated_afn) ?? D(0)),
        p_stated_usd: toMoneyString(parseAmount(moneyForm.stated_usd) ?? D(0)),
        p_notes: moneyForm.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => { setError(null); setMode(null); await invalidate(); },
    onError: (e) => setError(errMsg(e)),
  });

  const createStock = useMutation({
    mutationFn: async () => {
      const counts = stockForm.counts
        .filter((c) => c.variant_id && parseAmount(c.counted) !== null)
        .map((c) => ({ variant_id: c.variant_id, counted: toQtyString(parseAmount(c.counted)!) }));
      const { error } = await supabase().rpc("fn_reconcile_warehouse_stock", {
        p_warehouse_id: stockForm.warehouse_id || null,
        p_counts: counts,
        p_notes: null,
      });
      if (error) throw error;
    },
    onSuccess: async () => { setError(null); setMode(null); await invalidate(); },
    onError: (e) => setError(errMsg(e)),
  });

  const resolve = useMutation({
    mutationFn: async ({ recon, adjust, explanation }: { recon: Recon; adjust: boolean; explanation: string }) => {
      const fn = recon.rtype === "warehouse_stock" ? "fn_resolve_stock_reconciliation" : "fn_resolve_money_reconciliation";
      const args = recon.rtype === "warehouse_stock"
        ? { p_recon_id: recon.id, p_explanation: explanation }
        : { p_recon_id: recon.id, p_explanation: explanation, p_post_adjustment: adjust };
      const { error } = await supabase().rpc(fn, args);
      if (error) throw error;
    },
    onSuccess: async () => { setError(null); await invalidate(); },
    onError: (e) => setError(errMsg(e)),
  });

  const partyName = (r: Recon) => {
    if (r.rtype === "saraf") return (sarafs.data ?? []).find((s) => s.id === r.party_id)?.name ?? "";
    const w = (warehouses.data ?? []).find((x) => x.id === r.party_id);
    return w?.name ?? (r.rtype === "warehouse_stock" ? "Central" : "");
  };

  const fmtJson = (o: Record<string, string>, isQty = false) =>
    Object.entries(o).map(([k, v]) => {
      const label = isQty ? ((variants.data ?? []).find((x) => x.id === k)?.label ?? k) : k;
      return `${label}: ${v}`;
    }).join(" · ");

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-center gap-2">
        <span className="font-semibold text-lg"><L k="reconciliation" /></span>
        <button className="btn-secondary ml-auto" onClick={() => setMode(mode === "money" ? null : "money")}>
          <L k="money_ledger" />
        </button>
        <button className="btn-secondary" onClick={() => setMode(mode === "stock" ? null : "stock")}>
          <L k="stock" />
        </button>
        {error && <span className="w-full text-status-reversed text-xs" dir="auto">{error}</span>}
      </div>

      {mode === "money" && (
        <div className="panel p-3 space-y-3">
          <FieldGrid cols={6}>
            <Field k="kind">
              <Select value={moneyForm.rtype}
                onChange={(e) => setMoneyForm({ ...moneyForm, rtype: e.target.value as typeof moneyForm.rtype, party_id: "" })}>
                <option value="saraf">{lbl("saraf")}</option>
                <option value="warehouse_money">{lbl("warehouse")}</option>
              </Select>
            </Field>
            <Field k={moneyForm.rtype === "saraf" ? "saraf" : "warehouse"}>
              <Select value={moneyForm.party_id} onChange={(e) => setMoneyForm({ ...moneyForm, party_id: e.target.value })}>
                <option value="" />
                {(moneyForm.rtype === "saraf" ? sarafs.data ?? [] : warehouses.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </Field>
            <Field k="to_date">
              <DateInput value={moneyForm.period_end} onChange={(e) => setMoneyForm({ ...moneyForm, period_end: e.target.value })} />
            </Field>
            <Field k="external_balance">
              <AmountInput placeholder="AFN" value={moneyForm.stated_afn}
                onChange={(e) => setMoneyForm({ ...moneyForm, stated_afn: e.target.value })} />
            </Field>
            <Field k="external_balance">
              <AmountInput placeholder="USD" value={moneyForm.stated_usd}
                onChange={(e) => setMoneyForm({ ...moneyForm, stated_usd: e.target.value })} />
            </Field>
            <Field k="note">
              <TextInput value={moneyForm.notes} onChange={(e) => setMoneyForm({ ...moneyForm, notes: e.target.value })} />
            </Field>
          </FieldGrid>
          <button className="btn-primary" disabled={createMoney.isPending || !moneyForm.party_id}
            onClick={() => createMoney.mutate()}>
            <L k="create" />
          </button>
        </div>
      )}

      {mode === "stock" && (
        <div className="panel p-3 space-y-3">
          <FieldGrid cols={4}>
            <Field k="warehouse">
              <Select value={stockForm.warehouse_id}
                onChange={(e) => setStockForm({ ...stockForm, warehouse_id: e.target.value })}>
                <option value="">{lbl("central_stock")}</option>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
            </Field>
          </FieldGrid>
          {stockForm.counts.map((c, i) => (
            <div key={i} className="flex gap-2 items-end">
              <Field k="variant">
                <Select value={c.variant_id}
                  onChange={(e) => setStockForm({
                    ...stockForm,
                    counts: stockForm.counts.map((x, j) => (j === i ? { ...x, variant_id: e.target.value } : x)),
                  })}>
                  <option value="" />
                  {(variants.data ?? []).map((v) => (
                    <option key={v.id} value={v.id}>{v.products?.name} — {v.label}</option>
                  ))}
                </Select>
              </Field>
              <Field k="counted">
                <AmountInput value={c.counted}
                  onChange={(e) => setStockForm({
                    ...stockForm,
                    counts: stockForm.counts.map((x, j) => (j === i ? { ...x, counted: e.target.value } : x)),
                  })} />
              </Field>
              <button className="btn-secondary"
                onClick={() => setStockForm({ ...stockForm, counts: stockForm.counts.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <button className="btn-secondary"
              onClick={() => setStockForm({ ...stockForm, counts: [...stockForm.counts, { variant_id: "", counted: "" }] })}>
              <L k="add_line" />
            </button>
            <button className="btn-primary" disabled={createStock.isPending || stockForm.counts.length === 0}
              onClick={() => createStock.mutate()}>
              <L k="create" />
            </button>
          </div>
        </div>
      )}

      <div className="panel overflow-auto">
        <table className="erp-table">
          <thead>
            <tr>
              <th><L k="date" /></th><th><L k="kind" /></th><th><L k="name" /></th>
              <th><L k="system_balance" /></th><th><L k="external_balance" /></th>
              <th><L k="variance" /></th><th><L k="status" /></th><th><L k="actions" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="text-center py-4 text-ink-faint"><L k="loading" /></td></tr>
            ) : (
              (data ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="num">{fmtDate(r.period_end)}</td>
                  <td>{r.rtype}</td>
                  <td dir="auto">{partyName(r)}</td>
                  <td className="text-xs">{fmtJson(r.system_balance, r.rtype === "warehouse_stock")}</td>
                  <td className="text-xs">{fmtJson(r.external_balance, r.rtype === "warehouse_stock")}</td>
                  <td className="text-xs font-medium">{fmtJson(r.variance, r.rtype === "warehouse_stock")}</td>
                  <td><StatusChip status={r.status} /></td>
                  <td>
                    {r.status === "open" && profile?.role === "admin" && (
                      <div className="flex gap-1">
                        <button className="btn-secondary !h-5"
                          onClick={() => setResolveTarget({ recon: r, adjust: false })}>
                          <L k="resolved" />
                        </button>
                        {r.rtype !== "warehouse_stock" && (
                          <button className="btn-primary !h-5"
                            onClick={() => setResolveTarget({ recon: r, adjust: true })}>
                            <L k="adjustment" />
                          </button>
                        )}
                        {r.rtype === "warehouse_stock" && (
                          <button className="btn-primary !h-5"
                            onClick={() => setResolveTarget({ recon: r, adjust: true })}>
                            <L k="adjustment" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!resolveTarget}
        titleKey="confirm"
        promptKey="reason"
        onConfirm={(explanation) => {
          if (resolveTarget) {
            resolve.mutate({ recon: resolveTarget.recon, adjust: resolveTarget.adjust, explanation });
          }
          setResolveTarget(null);
        }}
        onCancel={() => setResolveTarget(null)}
      />
    </div>
  );
}
