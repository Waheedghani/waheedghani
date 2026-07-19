"use client";

import { lbl } from "@/lib/labels";
/**
 * Order detail: status header, landed-cost panel (auto/final/lock — admin),
 * truck receipts (draft -> post), route expenses (draft -> post).
 */
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { L } from "@/components/L";
import { StatusChip } from "@/components/StatusChip";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AmountInput, CurrencySelect, DateInput, Field, FieldGrid, Select, TextInput } from "@/components/ui/fields";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useVariants } from "@/lib/lookups";
import { useAuth } from "@/components/AuthProvider";
import { fmtDate, todayKabul } from "@/lib/dates";
import { fmtMoney, fmtQty, parseAmount, toMoneyString, toQtyString, D, type Currency } from "@/lib/money";

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const { profile } = useAuth();
  const variants = useVariants();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "truck" | "expense"; id: string } | null>(null);
  const [finalCost, setFinalCost] = useState("");

  const [truckForm, setTruckForm] = useState({
    receipt_date: todayKabul(), truck_ref: "", containers: "1",
    qty_expected: "", qty_received: "", qty_waste: "0", notes: "",
  });
  const [expForm, setExpForm] = useState({
    expense_date: todayKabul(), category: "shipping", description: "", description_ps: "",
    currency: "USD" as Currency, amount: "", fx_rate: "", paid_via: "cash", bank_name: "",
  });

  const { data: order, refetch } = useQuery({
    queryKey: ["order", id],
    queryFn: async () => {
      const sb = supabase();
      const [o, lc, trucks, exps] = await Promise.all([
        sb.from("v_order_status").select("*").eq("id", id).single(),
        sb.from("landed_costs").select("*").eq("order_id", id).single(),
        sb.from("truck_receipts").select("*").eq("order_id", id).order("created_at"),
        sb.from("order_expenses").select("*").eq("order_id", id).order("created_at"),
      ]);
      if (o.error) throw o.error;
      return {
        status: o.data,
        landed: lc.data,
        trucks: trucks.data ?? [],
        expenses: exps.data ?? [],
      };
    },
  });

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["order", id] });
    await qc.invalidateQueries({ queryKey: ["orders"] });
    await refetch();
  };

  const addTruck = useMutation({
    mutationFn: async () => {
      const { error } = await supabase().from("truck_receipts").insert({
        order_id: id,
        receipt_date: truckForm.receipt_date,
        truck_ref: truckForm.truck_ref || null,
        containers: Number.parseInt(truckForm.containers || "0", 10),
        qty_expected: toQtyString(parseAmount(truckForm.qty_expected) ?? D(0)),
        qty_received: toQtyString(parseAmount(truckForm.qty_received) ?? D(0)),
        qty_waste: toQtyString(parseAmount(truckForm.qty_waste) ?? D(0)),
        notes: truckForm.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => { setError(null); await invalidate(); },
    onError: (e) => setError(errMsg(e)),
  });

  const addExpense = useMutation({
    mutationFn: async () => {
      const { error } = await supabase().from("order_expenses").insert({
        order_id: id,
        expense_date: expForm.expense_date,
        category: expForm.category,
        description: expForm.description,
        description_ps: expForm.description_ps,
        currency: expForm.currency,
        amount: toMoneyString(parseAmount(expForm.amount) ?? D(0)),
        fx_rate: expForm.fx_rate ? expForm.fx_rate : null,
        paid_via: expForm.paid_via,
        bank_name: expForm.paid_via === "bank" ? expForm.bank_name : null,
      });
      if (error) throw error;
    },
    onSuccess: async () => { setError(null); await invalidate(); },
    onError: (e) => setError(errMsg(e)),
  });

  const postDoc = useMutation({
    mutationFn: async (c: { kind: "truck" | "expense"; id: string }) => {
      const fn = c.kind === "truck" ? "fn_post_truck_receipt" : "fn_post_order_expense";
      const arg = c.kind === "truck" ? { p_receipt_id: c.id } : { p_expense_id: c.id };
      const { error } = await supabase().rpc(fn, arg);
      if (error) throw error;
    },
    onSuccess: async () => { setError(null); await invalidate(); },
    onError: (e) => setError(errMsg(e)),
  });

  const setCost = useMutation({
    mutationFn: async () => {
      const { error } = await supabase().rpc("fn_set_final_landed_cost", {
        p_order_id: id, p_cost: finalCost,
      });
      if (error) throw error;
    },
    onSuccess: async () => { setError(null); setFinalCost(""); await invalidate(); },
    onError: (e) => setError(errMsg(e)),
  });

  const lockCost = useMutation({
    mutationFn: async () => {
      const { error } = await supabase().rpc("fn_lock_landed_cost", { p_order_id: id });
      if (error) throw error;
    },
    onSuccess: async () => { setError(null); await invalidate(); },
    onError: (e) => setError(errMsg(e)),
  });

  const closeOrder = useMutation({
    mutationFn: async () => {
      const { error } = await supabase().rpc("fn_close_order", { p_order_id: id });
      if (error) throw error;
    },
    onSuccess: async () => { setError(null); await invalidate(); },
    onError: (e) => setError(errMsg(e)),
  });

  if (!order) return <div className="text-ink-faint"><L k="loading" /></div>;
  const s = order.status;
  const lc = order.landed;
  const isAdmin = profile?.role === "admin";
  const variantLabel = (variants.data ?? []).find((v) => v.id === s.variant_id)?.label ?? "";
  const currency = (lc?.currency ?? "USD") as Currency;

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-center gap-4 flex-wrap">
        <span className="font-semibold text-lg">{s.doc_no}</span>
        <StatusChip status={s.status} />
        <span className="text-ink-soft">{fmtDate(s.order_date)} · {variantLabel}</span>
        {s.status === "received" && (
          <button className="btn-secondary ml-auto" onClick={() => closeOrder.mutate()}>
            <L k="close" />
          </button>
        )}
        {error && <span className="text-status-reversed text-xs w-full" dir="auto">{error}</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Stat k="qty_expected" v={fmtQty(s.qty_expected)} />
        <Stat k="qty_received" v={fmtQty(s.qty_received)} />
        <Stat k="waste" v={fmtQty(s.qty_waste)} />
        <Stat k="remaining" v={fmtQty(s.qty_remaining)} />
        <Stat k="trucks_received" v={String(s.trucks_received)} />
        <Stat k="trucks_remaining" v={String(s.trucks_remaining)} />
      </div>

      {/* Landed cost */}
      <div className="panel">
        <div className="panel-title flex items-center gap-2">
          <L k="landed_cost" />
          {lc?.locked_at && <StatusChip status="closed" />}
        </div>
        <div className="p-3 flex items-end gap-4 flex-wrap">
          <Stat k="auto_cost" v={fmtMoney(lc?.auto_cost_per_unit, currency, { dp: 6 })} />
          <Stat k="final_cost" v={fmtMoney(lc?.final_cost_per_unit, currency, { dp: 6 })} />
          <div className="text-xs text-ink-faint max-w-64">
            <L k="waste_absorbed_note" />
          </div>
          {isAdmin && !lc?.locked_at && (
            <div className="flex items-end gap-2 ml-auto">
              <Field k="final_cost">
                <AmountInput value={finalCost} onChange={(e) => setFinalCost(e.target.value)} className="w-32" />
              </Field>
              <button className="btn-secondary" disabled={!parseAmount(finalCost)} onClick={() => setCost.mutate()}>
                <L k="save" />
              </button>
              <button className="btn-secondary" onClick={() => lockCost.mutate()}>
                <L k="lock" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Truck receipts */}
      <div className="panel">
        <div className="panel-title"><L k="truck_receipts" /></div>
        <table className="erp-table">
          <thead>
            <tr>
              <th><L k="date" /></th>
              <th><L k="truck_ref" /></th>
              <th className="text-right"><L k="containers" /></th>
              <th className="text-right"><L k="qty_expected" /></th>
              <th className="text-right"><L k="qty_received" /></th>
              <th className="text-right"><L k="qty_waste" /></th>
              <th><L k="status" /></th>
              <th><L k="actions" /></th>
            </tr>
          </thead>
          <tbody>
            {order.trucks.map((t) => (
              <tr key={t.id}>
                <td className="num">{fmtDate(t.receipt_date)}</td>
                <td dir="auto">{t.truck_ref}</td>
                <td className="num">{t.containers}</td>
                <td className="num">{fmtQty(t.qty_expected)}</td>
                <td className="num">{fmtQty(t.qty_received)}</td>
                <td className="num">{fmtQty(t.qty_waste)}</td>
                <td><StatusChip status={t.status} /></td>
                <td>
                  {t.status === "draft" && (
                    <button className="btn-primary !h-5" onClick={() => setConfirm({ kind: "truck", id: t.id })}>
                      <L k="post" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.status !== "closed" && s.status !== "received" && (
          <div className="p-2 border-t border-line-soft">
            <FieldGrid cols={6}>
              <Field k="date"><DateInput value={truckForm.receipt_date} onChange={(e) => setTruckForm({ ...truckForm, receipt_date: e.target.value })} /></Field>
              <Field k="truck_ref"><TextInput value={truckForm.truck_ref} onChange={(e) => setTruckForm({ ...truckForm, truck_ref: e.target.value })} /></Field>
              <Field k="containers"><AmountInput value={truckForm.containers} onChange={(e) => setTruckForm({ ...truckForm, containers: e.target.value })} /></Field>
              <Field k="qty_expected"><AmountInput value={truckForm.qty_expected} onChange={(e) => setTruckForm({ ...truckForm, qty_expected: e.target.value })} /></Field>
              <Field k="qty_received"><AmountInput value={truckForm.qty_received} onChange={(e) => setTruckForm({ ...truckForm, qty_received: e.target.value })} /></Field>
              <Field k="qty_waste"><AmountInput value={truckForm.qty_waste} onChange={(e) => setTruckForm({ ...truckForm, qty_waste: e.target.value })} /></Field>
            </FieldGrid>
            <button className="btn-secondary mt-2" disabled={addTruck.isPending} onClick={() => addTruck.mutate()}>
              <L k="add_line" />
            </button>
          </div>
        )}
      </div>

      {/* Route expenses */}
      <div className="panel">
        <div className="panel-title"><L k="order_expenses" /></div>
        <table className="erp-table">
          <thead>
            <tr>
              <th><L k="date" /></th>
              <th><L k="category" /></th>
              <th><L k="description" /></th>
              <th><L k="currency" /></th>
              <th className="text-right"><L k="amount" /></th>
              <th className="text-right"><L k="fx_rate" /></th>
              <th><L k="paid_via" /></th>
              <th><L k="status" /></th>
              <th><L k="actions" /></th>
            </tr>
          </thead>
          <tbody>
            {order.expenses.map((x) => (
              <tr key={x.id}>
                <td className="num">{fmtDate(x.expense_date)}</td>
                <td>{x.category}</td>
                <td dir="auto">{x.description}</td>
                <td>{x.currency}</td>
                <td className="num">{fmtMoney(x.amount, x.currency as Currency)}</td>
                <td className="num">{x.fx_rate ?? ""}</td>
                <td>{x.paid_via}{x.bank_name ? ` (${x.bank_name})` : ""}</td>
                <td><StatusChip status={x.status} /></td>
                <td>
                  {x.status === "draft" && (
                    <button className="btn-primary !h-5" onClick={() => setConfirm({ kind: "expense", id: x.id })}>
                      <L k="post" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.status !== "closed" && (
          <div className="p-2 border-t border-line-soft">
            <FieldGrid cols={6}>
              <Field k="date"><DateInput value={expForm.expense_date} onChange={(e) => setExpForm({ ...expForm, expense_date: e.target.value })} /></Field>
              <Field k="category">
                <Select value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}>
                  <option value="shipping">{lbl("cat_shipping")}</option>
                  <option value="surcharge">{lbl("cat_surcharge")}</option>
                  <option value="customs">{lbl("cat_customs")}</option>
                  <option value="transport">{lbl("cat_transport")}</option>
                  <option value="other">{lbl("other")}</option>
                </Select>
              </Field>
              <Field k="description" span={2}><TextInput value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} /></Field>
              <Field k="currency"><CurrencySelect value={expForm.currency} onChange={(e) => setExpForm({ ...expForm, currency: e.target.value as Currency })} /></Field>
              <Field k="amount"><AmountInput value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} /></Field>
              <Field k="exchange_rate"><AmountInput value={expForm.fx_rate} onChange={(e) => setExpForm({ ...expForm, fx_rate: e.target.value })} /></Field>
              <Field k="paid_via">
                <Select value={expForm.paid_via} onChange={(e) => setExpForm({ ...expForm, paid_via: e.target.value })}>
                  <option value="cash">{lbl("cash")}</option>
                  <option value="bank">{lbl("bank")}</option>
                  <option value="payable">{lbl("payable")}</option>
                </Select>
              </Field>
              {expForm.paid_via === "bank" && (
                <Field k="bank_name"><TextInput value={expForm.bank_name} onChange={(e) => setExpForm({ ...expForm, bank_name: e.target.value })} /></Field>
              )}
            </FieldGrid>
            <button className="btn-secondary mt-2" disabled={addExpense.isPending || !expForm.description} onClick={() => addExpense.mutate()}>
              <L k="add_line" />
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirm}
        titleKey="confirm_post_title"
        bodyKey="posting_permanent"
        onConfirm={() => {
          if (confirm) postDoc.mutate(confirm);
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function Stat({ k, v }: { k: Parameters<typeof L>[0]["k"]; v: string }) {
  return (
    <div className="panel px-3 py-1.5">
      <div className="text-xs text-ink-soft"><L k={k} /></div>
      <div className="font-semibold num text-lg">{v}</div>
    </div>
  );
}
