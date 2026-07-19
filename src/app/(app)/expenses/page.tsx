"use client";

import { lbl } from "@/lib/labels";
/** Office expenses: categorized; cash feeds the Roznamcha, saraf the ledger. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/ui/DataTable";
import { dateCol, moneyCol, statusCol, textCol } from "@/components/ui/cols";
import { AmountInput, CurrencySelect, DateInput, Field, FieldGrid, Select, TextInput } from "@/components/ui/fields";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useExpenseCategories, useSarafs } from "@/lib/lookups";
import { D, parseAmount, toMoneyString, type Currency } from "@/lib/money";
import { todayKabul } from "@/lib/dates";

interface Row {
  id: string;
  doc_no: string | null;
  expense_date: string;
  description: string;
  currency: Currency;
  amount: string;
  paid_via: string;
  bank_name: string | null;
  status: string;
  expense_categories: { name: string; name_ps: string } | null;
}

export default function ExpensesPage() {
  const qc = useQueryClient();
  const categories = useExpenseCategories();
  const sarafs = useSarafs();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [form, setForm] = useState({
    expense_date: todayKabul(),
    category_id: "",
    description: "",
    description_ps: "",
    currency: "AFN" as Currency,
    amount: "",
    paid_via: "cash" as "cash" | "bank" | "saraf",
    bank_name: "",
    saraf_id: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["office_expenses"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("office_expenses")
        .select("id, doc_no, expense_date, description, currency, amount, paid_via, bank_name, status, expense_categories(name, name_ps)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as unknown as Row[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase().from("office_expenses").insert({
        expense_date: form.expense_date,
        category_id: form.category_id,
        description: form.description,
        description_ps: form.description_ps,
        currency: form.currency,
        amount: toMoneyString(parseAmount(form.amount) ?? D(0)),
        paid_via: form.paid_via,
        bank_name: form.paid_via === "bank" ? form.bank_name : null,
        saraf_id: form.paid_via === "saraf" ? form.saraf_id : null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setError(null);
      setShowForm(false);
      await qc.invalidateQueries({ queryKey: ["office_expenses"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  const post = useMutation({
    mutationFn: async (expId: string) => {
      const { error } = await supabase().rpc("fn_post_office_expense", { p_id: expId });
      if (error) throw error;
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["office_expenses"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  return (
    <div className="space-y-2">
      {error && <div className="text-status-reversed text-xs" dir="auto">{error}</div>}
      <DataTable<Row>
        loading={isLoading}
        data={data ?? []}
        exportName="office-expenses"
        onRowOpen={(r) => { if (r.status === "draft") setConfirmId(r.id); }}
        toolbar={
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            <L k="new" />
          </button>
        }
        columns={[
          textCol("doc_no", "doc_no", (r) => r.doc_no ?? `(${lbl("draft")})`, 110),
          dateCol("expense_date", "date", (r) => r.expense_date),
          textCol("category", "category", (r) => r.expense_categories?.name, 120),
          textCol("description", "description", (r) => r.description, 220),
          textCol("paid_via", "paid_via", (r) => r.paid_via + (r.bank_name ? ` (${r.bank_name})` : ""), 110),
          textCol("currency", "currency", (r) => r.currency, 60),
          moneyCol("amount", "amount", (r) => r.amount, (r) => r.currency),
          statusCol((r) => r.status),
        ]}
      />

      {showForm && (
        <div className="panel p-3 space-y-3">
          <div className="panel-title -mx-3 -mt-3 mb-2"><L k="new" /> — <L k="office_expenses" /></div>
          <FieldGrid cols={4}>
            <Field k="date">
              <DateInput value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
            </Field>
            <Field k="category">
              <Select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="" />
                {(categories.data ?? []).filter((c) => c.is_active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name} / {c.name_ps}</option>
                ))}
              </Select>
            </Field>
            <Field k="description" span={2}>
              <TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field k="paid_via">
              <Select value={form.paid_via} onChange={(e) => setForm({ ...form, paid_via: e.target.value as typeof form.paid_via })}>
                <option value="cash">{lbl("cash")}</option>
                <option value="bank">{lbl("bank")}</option>
                <option value="saraf">{lbl("saraf")}</option>
              </Select>
            </Field>
            {form.paid_via === "bank" && (
              <Field k="bank_name">
                <TextInput value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
              </Field>
            )}
            {form.paid_via === "saraf" && (
              <Field k="saraf">
                <Select value={form.saraf_id} onChange={(e) => setForm({ ...form, saraf_id: e.target.value })}>
                  <option value="" />
                  {(sarafs.data ?? []).filter((s) => s.is_active).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
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
              disabled={
                create.isPending || !form.category_id || !form.description || !parseAmount(form.amount) ||
                (form.paid_via === "saraf" && !form.saraf_id) ||
                (form.paid_via === "bank" && !form.bank_name)
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
