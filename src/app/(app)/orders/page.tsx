"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/ui/DataTable";
import { dateCol, qtyCol, statusCol, textCol } from "@/components/ui/cols";
import { DateInput, Field, FieldGrid, Select, TextInput, AmountInput } from "@/components/ui/fields";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useVariants } from "@/lib/lookups";
import { todayKabul } from "@/lib/dates";

interface Row {
  id: string;
  doc_no: string;
  order_date: string;
  status: string;
  qty_expected: string;
  qty_received: string;
  qty_waste: string;
  qty_remaining: string;
  trucks_total: number;
  trucks_received: number;
  trucks_remaining: number;
  supplier_id: string;
  variant_id: string;
}

export default function OrdersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const variants = useVariants();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    order_date: todayKabul(),
    purchase_invoice_id: "",
    variant_id: "",
    trucks_total: "1",
    containers_total: "1",
    units_per_container: "1150",
    bill_number: "",
    container_numbers: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("v_order_status")
        .select("*")
        .order("doc_no", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as Row[];
    },
  });

  const { data: postedInvoices } = useQuery({
    queryKey: ["posted_invoices"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("purchase_invoices")
        .select("id, doc_no, suppliers(name)")
        .neq("status", "draft")
        .order("doc_no", { ascending: false });
      if (error) throw error;
      return data as unknown as Array<{ id: string; doc_no: string; suppliers: { name: string } | null }>;
    },
  });

  const variantLabel = (id: string) =>
    (variants.data ?? []).find((v) => v.id === id)?.label ?? "";

  const create = useMutation({
    mutationFn: async () => {
      const inv = (postedInvoices ?? []).find((i) => i.id === form.purchase_invoice_id);
      if (!inv) throw new Error("purchase invoice required");
      const { error } = await supabase().from("orders").insert({
        order_date: form.order_date,
        purchase_invoice_id: form.purchase_invoice_id,
        supplier_id: form.purchase_invoice_id, // overwritten by trigger from the invoice
        variant_id: form.variant_id,
        trucks_total: Number.parseInt(form.trucks_total, 10),
        containers_total: Number.parseInt(form.containers_total, 10),
        units_per_container: form.units_per_container,
        bill_number: form.bill_number || null,
        container_numbers: form.container_numbers.split(",").map((s) => s.trim()).filter(Boolean),
        doc_no: "pending", // replaced by the numbering trigger
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setError(null);
      setShowForm(false);
      await qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  return (
    <div className="space-y-2">
      {error && <div className="text-status-reversed text-xs" dir="auto">{error}</div>}
      <DataTable<Row>
        loading={isLoading}
        data={data ?? []}
        exportName="orders"
        onRowOpen={(r) => router.push(`/orders/${r.id}`)}
        toolbar={
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            <L k="new" />
          </button>
        }
        columns={[
          textCol("doc_no", "doc_no", (r) => r.doc_no, 120),
          dateCol("order_date", "date", (r) => r.order_date),
          textCol("variant", "variant", (r) => variantLabel(r.variant_id), 130),
          qtyCol("qty_expected", "qty_expected", (r) => r.qty_expected),
          qtyCol("qty_received", "qty_received", (r) => r.qty_received),
          qtyCol("qty_waste", "waste", (r) => r.qty_waste),
          qtyCol("qty_remaining", "remaining", (r) => r.qty_remaining),
          qtyCol("trucks_received", "trucks_received", (r) => String(r.trucks_received), 90),
          qtyCol("trucks_remaining", "trucks_remaining", (r) => String(r.trucks_remaining), 90),
          statusCol((r) => r.status, 140),
        ]}
      />

      {showForm && (
        <div className="panel p-3 space-y-3">
          <div className="panel-title -mx-3 -mt-3 mb-2">
            <L k="new" /> — <L k="order" />
          </div>
          <FieldGrid cols={4}>
            <Field k="date">
              <DateInput value={form.order_date} onChange={(e) => setForm({ ...form, order_date: e.target.value })} />
            </Field>
            <Field k="invoice_no">
              <Select
                value={form.purchase_invoice_id}
                onChange={(e) => setForm({ ...form, purchase_invoice_id: e.target.value })}
              >
                <option value="" />
                {(postedInvoices ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.doc_no} — {i.suppliers?.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field k="variant">
              <Select value={form.variant_id} onChange={(e) => setForm({ ...form, variant_id: e.target.value })}>
                <option value="" />
                {(variants.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.products?.name} — {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field k="trucks_total">
              <AmountInput value={form.trucks_total} onChange={(e) => setForm({ ...form, trucks_total: e.target.value })} />
            </Field>
            <Field k="containers_count">
              <AmountInput value={form.containers_total} onChange={(e) => setForm({ ...form, containers_total: e.target.value })} />
            </Field>
            <Field k="bottles_per_container">
              <AmountInput value={form.units_per_container} onChange={(e) => setForm({ ...form, units_per_container: e.target.value })} />
            </Field>
            <Field k="bill_number">
              <TextInput value={form.bill_number} onChange={(e) => setForm({ ...form, bill_number: e.target.value })} />
            </Field>
            <Field k="container_no">
              <TextInput value={form.container_numbers} onChange={(e) => setForm({ ...form, container_numbers: e.target.value })} />
            </Field>
          </FieldGrid>
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={create.isPending || !form.purchase_invoice_id || !form.variant_id}
              onClick={() => create.mutate()}
            >
              <L k="create" />
            </button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>
              <L k="cancel" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
