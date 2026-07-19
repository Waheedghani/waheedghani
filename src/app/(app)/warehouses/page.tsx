"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { DataTable } from "@/components/ui/DataTable";
import { textCol } from "@/components/ui/cols";
import { Field, FieldGrid, TextInput } from "@/components/ui/fields";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useWarehouses } from "@/lib/lookups";
import type { Warehouse } from "@/lib/types";
import { StatusChip } from "@/components/StatusChip";

interface WarehouseForm {
  name: string;
  name_ps: string;
  keeper_name: string;
  phone: string;
  address: string;
}

export default function WarehousesPage() {
  const router = useRouter();
  const { data, isLoading } = useWarehouses();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset } = useForm<WarehouseForm>();

  const save = useMutation({
    mutationFn: async (values: WarehouseForm) => {
      const { error } = await supabase().from("warehouses").insert(values);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["warehouses"] });
      setCreating(false);
      setError(null);
      reset();
    },
    onError: (e) => setError(errMsg(e)),
  });

  return (
    <div className="space-y-2">
      <DataTable<Warehouse>
        loading={isLoading}
        data={data ?? []}
        exportName="warehouses"
        onRowOpen={(w) => router.push(`/warehouses/${w.id}`)}
        toolbar={
          <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
            <L k="new" />
          </button>
        }
        columns={[
          textCol("name", "name", (w) => w.name, 200),
          textCol("name_ps", "name_ps", (w) => w.name_ps, 160),
          textCol("keeper", "keeper_name", (w) => w.keeper_name, 150),
          textCol("phone", "phone", (w) => w.phone, 120),
          textCol("address", "address", (w) => w.address, 180),
          {
            id: "active",
            header: () => <L k="is_active" />,
            accessorFn: (w) => (w.is_active ? "active" : "inactive"),
            cell: (c) => <StatusChip status={c.getValue() === "active" ? "posted" : "draft"} />,
            size: 90,
            meta: { csvHeader: "Active" },
          },
        ]}
      />

      {creating && (
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="panel p-3 space-y-3">
          <div className="panel-title -mx-3 -mt-3 mb-2">
            <L k="new" /> — <L k="warehouse" />
          </div>
          <FieldGrid cols={3}>
            <Field k="name"><TextInput {...register("name", { required: true })} autoFocus /></Field>
            <Field k="name_ps"><TextInput {...register("name_ps")} className="font-pashto" /></Field>
            <Field k="keeper_name"><TextInput {...register("keeper_name")} /></Field>
            <Field k="phone"><TextInput {...register("phone")} /></Field>
            <Field k="address"><TextInput {...register("address")} /></Field>
          </FieldGrid>
          {error && <div className="text-status-reversed text-xs" dir="auto">{error}</div>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={save.isPending}><L k="save" /></button>
            <button type="button" className="btn-secondary" onClick={() => setCreating(false)}><L k="cancel" /></button>
          </div>
        </form>
      )}
    </div>
  );
}
