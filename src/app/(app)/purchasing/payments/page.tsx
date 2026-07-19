"use client";

import { lbl } from "@/lib/labels";
/** Supplier payments: list + inline new-payment form (advance / settlement). */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/ui/DataTable";
import { dateCol, moneyCol, statusCol, textCol } from "@/components/ui/cols";
import { AmountInput, CurrencySelect, DateInput, Field, FieldGrid, Select, TextInput } from "@/components/ui/fields";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useSuppliers } from "@/lib/lookups";
import { D, parseAmount, toMoneyString, type Currency } from "@/lib/money";
import { todayKabul } from "@/lib/dates";

interface Row {
  id: string;
  doc_no: string | null;
  payment_date: string;
  kind: string;
  method: string;
  bank_name: string | null;
  currency: Currency;
  amount: string;
  status: string;
  suppliers: { name: string } | null;
}

interface FormState {
  payment_date: string;
  supplier_id: string;
  kind: "advance" | "settlement";
  method: "cash" | "bank";
  bank_name: string;
  currency: Currency;
  amount: string;
}

export default function SupplierPaymentsPage() {
  const qc = useQueryClient();
  const suppliers = useSuppliers();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    payment_date: todayKabul(),
    supplier_id: "",
    kind: "advance",
    method: "cash",
    bank_name: "",
    currency: "USD",
    amount: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["supplier_payments"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("supplier_payments")
        .select("id, doc_no, payment_date, kind, method, bank_name, currency, amount, status, suppliers(name)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as unknown as Row[];
    },
  });

  const createDraft = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase()
        .from("supplier_payments")
        .insert({
          payment_date: form.payment_date,
          supplier_id: form.supplier_id,
          kind: form.kind,
          method: form.method,
          bank_name: form.method === "bank" ? form.bank_name : null,
          currency: form.currency,
          amount: toMoneyString(parseAmount(form.amount) ?? D(0)),
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: async () => {
      setError(null);
      setShowForm(false);
      await qc.invalidateQueries({ queryKey: ["supplier_payments"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  const post = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await supabase().rpc("fn_post_supplier_payment", { p_payment_id: paymentId });
      if (error) throw error;
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["supplier_payments"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  return (
    <div className="space-y-2">
      {error && <div className="text-status-reversed text-xs" dir="auto">{error}</div>}
      <DataTable<Row>
        loading={isLoading}
        data={data ?? []}
        exportName="supplier-payments"
        toolbar={
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            <L k="new" />
          </button>
        }
        onRowOpen={(r) => {
          if (r.status === "draft") setConfirmId(r.id);
        }}
        columns={[
          textCol("doc_no", "doc_no", (r) => r.doc_no ?? "(draft)", 110),
          dateCol("payment_date", "date", (r) => r.payment_date),
          textCol("supplier", "supplier", (r) => r.suppliers?.name, 180),
          textCol("kind", "kind", (r) => r.kind, 100),
          textCol("method", "method", (r) => r.method, 80),
          textCol("bank", "bank_name", (r) => r.bank_name, 110),
          textCol("currency", "currency", (r) => r.currency, 70),
          moneyCol("amount", "amount", (r) => r.amount, (r) => r.currency),
          statusCol((r) => r.status),
        ]}
      />

      {showForm && (
        <div className="panel p-3 space-y-3">
          <div className="panel-title -mx-3 -mt-3 mb-2">
            <L k="new" /> — <L k="supplier_payments" />
          </div>
          <FieldGrid cols={4}>
            <Field k="date">
              <DateInput value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
            </Field>
            <Field k="supplier">
              <Select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="" />
                {(suppliers.data ?? []).filter((s) => s.is_active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <Field k="kind">
              <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as FormState["kind"] })}>
                <option value="advance">{lbl("advance")}</option>
                <option value="settlement">{lbl("settlement")}</option>
              </Select>
            </Field>
            <Field k="method">
              <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as FormState["method"] })}>
                <option value="cash">{lbl("cash")}</option>
                <option value="bank">{lbl("bank")}</option>
              </Select>
            </Field>
            {form.method === "bank" && (
              <Field k="bank_name">
                <TextInput value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
              </Field>
            )}
            <Field k="currency">
              <CurrencySelect value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })} />
            </Field>
            <Field k="amount">
              <AmountInput value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
          </FieldGrid>
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={createDraft.isPending || !form.supplier_id || !parseAmount(form.amount)}
              onClick={() => createDraft.mutate()}
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
