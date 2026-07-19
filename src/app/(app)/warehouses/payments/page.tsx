"use client";

import { lbl } from "@/lib/labels";
/** Warehouse payments: cash or via saraf; cross-currency settlement at the
 *  manual bazaar rate; bill references for the سرای statement. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/ui/DataTable";
import { dateCol, moneyCol, statusCol, textCol } from "@/components/ui/cols";
import { AmountInput, CurrencySelect, DateInput, Field, FieldGrid, Select, TextInput } from "@/components/ui/fields";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useSarafs, useWarehouses } from "@/lib/lookups";
import { D, parseAmount, toMoneyString, type Currency } from "@/lib/money";
import { todayKabul } from "@/lib/dates";

interface Row {
  id: string;
  doc_no: string | null;
  payment_date: string;
  currency: Currency;
  amount: string;
  settle_currency: Currency | null;
  fx_rate: string | null;
  method: string;
  hawala_number: string | null;
  bill_refs: string[];
  status: string;
  warehouses: { name: string } | null;
  sarafs: { name: string } | null;
}

export default function WarehousePaymentsPage() {
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const sarafs = useSarafs();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [form, setForm] = useState({
    payment_date: todayKabul(),
    warehouse_id: "",
    currency: "AFN" as Currency,
    amount: "",
    settle_currency: "" as "" | Currency,
    fx_rate: "",
    method: "cash" as "cash" | "saraf",
    saraf_id: "",
    hawala_number: "",
    bill_refs: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["warehouse_payments_all"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("warehouse_payments")
        .select("id, doc_no, payment_date, currency, amount, settle_currency, fx_rate, method, hawala_number, bill_refs, status, warehouses(name), sarafs(name)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as unknown as Row[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase().from("warehouse_payments").insert({
        payment_date: form.payment_date,
        warehouse_id: form.warehouse_id,
        currency: form.currency,
        amount: toMoneyString(parseAmount(form.amount) ?? D(0)),
        settle_currency: form.settle_currency || null,
        fx_rate: form.fx_rate || null,
        method: form.method,
        saraf_id: form.method === "saraf" ? form.saraf_id : null,
        hawala_number: form.hawala_number || null,
        bill_refs: form.bill_refs.split(",").map((s) => s.trim()).filter(Boolean),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setError(null);
      setShowForm(false);
      await qc.invalidateQueries({ queryKey: ["warehouse_payments_all"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  const post = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await supabase().rpc("fn_post_warehouse_payment", { p_payment_id: paymentId });
      if (error) throw error;
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["warehouse_payments_all"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  const crossCurrency = form.settle_currency && form.settle_currency !== form.currency;

  return (
    <div className="space-y-2">
      {error && <div className="text-status-reversed text-xs" dir="auto">{error}</div>}
      <DataTable<Row>
        loading={isLoading}
        data={data ?? []}
        exportName="warehouse-payments"
        onRowOpen={(r) => { if (r.status === "draft") setConfirmId(r.id); }}
        toolbar={
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            <L k="new" />
          </button>
        }
        columns={[
          textCol("doc_no", "doc_no", (r) => r.doc_no ?? "(draft)", 110),
          dateCol("payment_date", "date", (r) => r.payment_date),
          textCol("warehouse", "warehouse", (r) => r.warehouses?.name, 170),
          textCol("method", "method", (r) => r.method, 70),
          textCol("saraf", "saraf", (r) => r.sarafs?.name, 120),
          textCol("hawala", "hawala_no", (r) => r.hawala_number, 100),
          textCol("currency", "currency", (r) => r.currency, 60),
          moneyCol("amount", "amount", (r) => r.amount, (r) => r.currency),
          textCol("fx", "exchange_rate", (r) => r.fx_rate, 80),
          textCol("bills", "bill_refs", (r) => r.bill_refs.join(", "), 140),
          statusCol((r) => r.status),
        ]}
      />

      {showForm && (
        <div className="panel p-3 space-y-3">
          <div className="panel-title -mx-3 -mt-3 mb-2">
            <L k="new" /> — <L k="warehouse_payments" />
          </div>
          <FieldGrid cols={4}>
            <Field k="date">
              <DateInput value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
            </Field>
            <Field k="warehouse">
              <Select value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
                <option value="" />
                {(warehouses.data ?? []).filter((w) => w.is_active).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
            </Field>
            <Field k="method">
              <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as "cash" | "saraf" })}>
                <option value="cash">{lbl("cash")}</option>
                <option value="saraf">{lbl("saraf")}</option>
              </Select>
            </Field>
            {form.method === "saraf" && (
              <>
                <Field k="saraf">
                  <Select value={form.saraf_id} onChange={(e) => setForm({ ...form, saraf_id: e.target.value })}>
                    <option value="" />
                    {(sarafs.data ?? []).filter((s) => s.is_active).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field k="hawala_no">
                  <TextInput value={form.hawala_number} onChange={(e) => setForm({ ...form, hawala_number: e.target.value })} />
                </Field>
              </>
            )}
            <Field k="currency">
              <CurrencySelect value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })} />
            </Field>
            <Field k="amount">
              <AmountInput value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field k="balance">
              <Select
                value={form.settle_currency}
                onChange={(e) => setForm({ ...form, settle_currency: e.target.value as "" | Currency })}
              >
                <option value="">{lbl("same_currency")}</option>
                <option value="AFN">{lbl("settles_afn")}</option>
                <option value="USD">{lbl("settles_usd")}</option>
              </Select>
            </Field>
            {crossCurrency && (
              <Field k="exchange_rate">
                <AmountInput value={form.fx_rate} onChange={(e) => setForm({ ...form, fx_rate: e.target.value })} />
              </Field>
            )}
            <Field k="bill_refs" span={2}>
              <TextInput value={form.bill_refs} placeholder="DSP-2026-0001, DSP-2026-0002"
                onChange={(e) => setForm({ ...form, bill_refs: e.target.value })} />
            </Field>
          </FieldGrid>
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={
                create.isPending || !form.warehouse_id || !parseAmount(form.amount) ||
                (form.method === "saraf" && !form.saraf_id) ||
                (!!crossCurrency && !parseAmount(form.fx_rate))
              }
              onClick={() => create.mutate()}
            >
              <L k="save" />
            </button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>
              <L k="cancel" />
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmId}
        titleKey="confirm_post_title"
        bodyKey="posting_permanent"
        onConfirm={() => {
          if (confirmId) post.mutate(confirmId);
          setConfirmId(null);
        }}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}
