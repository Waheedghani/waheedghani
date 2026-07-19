"use client";

import { lbl } from "@/lib/labels";
/** Saraf transactions: hawala register (deposits, releases, linked records). */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/ui/DataTable";
import { dateCol, moneyCol, statusCol, textCol } from "@/components/ui/cols";
import { AmountInput, CurrencySelect, DateInput, Field, FieldGrid, Select, TextInput } from "@/components/ui/fields";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useSarafs } from "@/lib/lookups";
import { D, parseAmount, toMoneyString, type Currency } from "@/lib/money";
import { todayKabul } from "@/lib/dates";

interface Row {
  id: string;
  doc_no: string | null;
  txn_date: string;
  direction: "in" | "out";
  currency: Currency;
  amount: string;
  hawala_number: string | null;
  description: string;
  linked_source_type: string | null;
  status: string;
  sarafs: { name: string } | null;
}

export default function SarafTransactionsPage() {
  const qc = useQueryClient();
  const sarafs = useSarafs();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [form, setForm] = useState({
    txn_date: todayKabul(),
    saraf_id: "",
    direction: "in" as "in" | "out",
    currency: "AFN" as Currency,
    amount: "",
    hawala_number: "",
    description: "",
    description_ps: "",
    note: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["saraf_transactions"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("saraf_transactions")
        .select("id, doc_no, txn_date, direction, currency, amount, hawala_number, description, linked_source_type, status, sarafs(name)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as unknown as Row[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase().from("saraf_transactions").insert({
        txn_date: form.txn_date,
        saraf_id: form.saraf_id,
        direction: form.direction,
        currency: form.currency,
        amount: toMoneyString(parseAmount(form.amount) ?? D(0)),
        hawala_number: form.hawala_number || null,
        description: form.description,
        description_ps: form.description_ps,
        note: form.note || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setError(null);
      setShowForm(false);
      await qc.invalidateQueries({ queryKey: ["saraf_transactions"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  const post = useMutation({
    mutationFn: async (txnId: string) => {
      const { error } = await supabase().rpc("fn_post_saraf_transaction", { p_txn_id: txnId });
      if (error) throw error;
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["saraf_transactions"] });
      await qc.invalidateQueries({ queryKey: ["saraf_balances"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  return (
    <div className="space-y-2">
      <div className="text-xs text-ink-faint"><L k="saraf_not_in_roznamcha" /></div>
      {error && <div className="text-status-reversed text-xs" dir="auto">{error}</div>}
      <DataTable<Row>
        loading={isLoading}
        data={data ?? []}
        exportName="saraf-transactions"
        onRowOpen={(r) => {
          if (r.status === "draft" && !r.linked_source_type) setConfirmId(r.id);
        }}
        toolbar={
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            <L k="new" />
          </button>
        }
        columns={[
          textCol("doc_no", "doc_no", (r) => r.doc_no ?? `(${lbl("draft")})`, 110),
          dateCol("txn_date", "date", (r) => r.txn_date),
          textCol("saraf", "saraf", (r) => r.sarafs?.name, 150),
          {
            id: "direction",
            header: () => <L k="direction" />,
            accessorFn: (r) => r.direction,
            cell: (c) => (c.getValue() === "in" ? <L k="cash_in" /> : <L k="cash_out" />),
            size: 110,
            meta: { csvHeader: "Direction" },
          },
          textCol("hawala", "hawala_no", (r) => r.hawala_number, 100),
          textCol("currency", "currency", (r) => r.currency, 60),
          moneyCol("amount", "amount", (r) => r.amount, (r) => r.currency),
          textCol("description", "description", (r) => r.description, 200),
          textCol("linked", "record", (r) => r.linked_source_type, 130),
          statusCol((r) => r.status),
        ]}
      />

      {showForm && (
        <div className="panel p-3 space-y-3">
          <div className="panel-title -mx-3 -mt-3 mb-2"><L k="new" /> — <L k="saraf_transactions" /></div>
          <FieldGrid cols={4}>
            <Field k="date">
              <DateInput value={form.txn_date} onChange={(e) => setForm({ ...form, txn_date: e.target.value })} />
            </Field>
            <Field k="saraf">
              <Select value={form.saraf_id} onChange={(e) => setForm({ ...form, saraf_id: e.target.value })}>
                <option value="" />
                {(sarafs.data ?? []).filter((s) => s.is_active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <Field k="direction">
              <Select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as "in" | "out" })}>
                <option value="in">{lbl("cash_in_to_saraf")}</option>
                <option value="out">{lbl("cash_out_from_saraf")}</option>
              </Select>
            </Field>
            <Field k="hawala_no">
              <TextInput value={form.hawala_number} onChange={(e) => setForm({ ...form, hawala_number: e.target.value })} />
            </Field>
            <Field k="currency">
              <CurrencySelect value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })} />
            </Field>
            <Field k="amount">
              <AmountInput value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field k="description" span={2}>
              <TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field k="note" span={2}>
              <TextInput value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
          </FieldGrid>
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={create.isPending || !form.saraf_id || !parseAmount(form.amount)}
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
