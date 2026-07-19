"use client";

/** Keeper buyer-pickup records: goods leaving the سرای against company bills. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/ui/DataTable";
import { dateCol, qtyCol, textCol } from "@/components/ui/cols";
import { AmountInput, DateInput, Field, FieldGrid, Select, TextInput } from "@/components/ui/fields";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useVariants } from "@/lib/lookups";
import { useAuth } from "@/components/AuthProvider";
import { todayKabul } from "@/lib/dates";
import { parseAmount, toQtyString } from "@/lib/money";

interface Pickup {
  id: string;
  pickup_date: string;
  variant_id: string;
  qty: string;
  buyer_name: string;
  bill_ref: string | null;
  notes: string | null;
}

export default function PortalPickupsPage() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const variants = useVariants();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    pickup_date: todayKabul(),
    variant_id: "",
    qty: "",
    buyer_name: "",
    bill_ref: "",
    notes: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["portal_pickups"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("warehouse_pickups")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as Pickup[];
    },
  });

  const record = useMutation({
    mutationFn: async () => {
      const qty = parseAmount(form.qty);
      if (!qty) throw new Error("invalid quantity");
      const { error } = await supabase().rpc("fn_record_pickup", {
        p_warehouse_id: profile!.warehouse_id!,
        p_variant_id: form.variant_id,
        p_qty: toQtyString(qty),
        p_buyer_name: form.buyer_name,
        p_bill_ref: form.bill_ref || null,
        p_pickup_date: form.pickup_date,
        p_notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setError(null);
      setForm({ ...form, qty: "", buyer_name: "", bill_ref: "", notes: "" });
      await qc.invalidateQueries({ queryKey: ["portal_pickups"] });
      await qc.invalidateQueries({ queryKey: ["portal_stock"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  const variantLabel = (id: string) => (variants.data ?? []).find((v) => v.id === id)?.label ?? "";

  return (
    <div className="space-y-2">
      <div className="panel p-3 space-y-3">
        <div className="panel-title -mx-3 -mt-3 mb-2"><L k="new" /> — <L k="buyer_pickups" /></div>
        <FieldGrid cols={6}>
          <Field k="date">
            <DateInput value={form.pickup_date} onChange={(e) => setForm({ ...form, pickup_date: e.target.value })} />
          </Field>
          <Field k="variant">
            <Select value={form.variant_id} onChange={(e) => setForm({ ...form, variant_id: e.target.value })}>
              <option value="" />
              {(variants.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>{v.products?.name} — {v.label}</option>
              ))}
            </Select>
          </Field>
          <Field k="quantity">
            <AmountInput value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
          </Field>
          <Field k="buyer_name">
            <TextInput value={form.buyer_name} onChange={(e) => setForm({ ...form, buyer_name: e.target.value })} />
          </Field>
          <Field k="bill_number">
            <TextInput value={form.bill_ref} onChange={(e) => setForm({ ...form, bill_ref: e.target.value })} />
          </Field>
          <Field k="note">
            <TextInput value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </FieldGrid>
        {error && <div className="text-status-reversed text-xs" dir="auto">{error}</div>}
        <button
          className="btn-primary"
          disabled={record.isPending || !form.variant_id || !form.buyer_name || !parseAmount(form.qty)}
          onClick={() => record.mutate()}
        >
          <L k="save" />
        </button>
      </div>

      <DataTable<Pickup>
        loading={isLoading}
        data={data ?? []}
        exportName="pickups"
        columns={[
          dateCol("pickup_date", "date", (r) => r.pickup_date),
          textCol("variant", "variant", (r) => variantLabel(r.variant_id), 150),
          qtyCol("qty", "quantity", (r) => r.qty),
          textCol("buyer_name", "buyer_name", (r) => r.buyer_name, 180),
          textCol("bill_ref", "bill_number", (r) => r.bill_ref, 120),
          textCol("notes", "note", (r) => r.notes, 200),
        ]}
      />
    </div>
  );
}
