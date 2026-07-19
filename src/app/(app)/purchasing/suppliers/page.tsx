"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { DataTable } from "@/components/ui/DataTable";
import { textCol } from "@/components/ui/cols";
import { Field, FieldGrid, TextInput } from "@/components/ui/fields";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useSuppliers } from "@/lib/lookups";
import type { Supplier } from "@/lib/types";
import { StatusChip } from "@/components/StatusChip";

interface SupplierForm {
  name: string;
  name_ps: string;
  country: string;
  contact: string;
  phone: string;
  address: string;
}

export default function SuppliersPage() {
  const { data, isLoading } = useSuppliers();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset } = useForm<SupplierForm>();

  const save = useMutation({
    mutationFn: async (values: SupplierForm) => {
      const sb = supabase();
      if (editing === "new") {
        const { error } = await sb.from("suppliers").insert(values);
        if (error) throw error;
      } else if (editing) {
        const { error } = await sb.from("suppliers").update(values).eq("id", editing.id);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["suppliers"] });
      setEditing(null);
      setError(null);
    },
    onError: (e) => setError(errMsg(e)),
  });

  const toggleActive = useMutation({
    mutationFn: async (s: Supplier) => {
      const { error } = await supabase().from("suppliers").update({ is_active: !s.is_active }).eq("id", s.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });

  function openEdit(s: Supplier | "new") {
    setEditing(s);
    reset(
      s === "new"
        ? { name: "", name_ps: "", country: "Malaysia", contact: "", phone: "", address: "" }
        : {
            name: s.name,
            name_ps: s.name_ps,
            country: s.country,
            contact: s.contact ?? "",
            phone: s.phone ?? "",
            address: s.address ?? "",
          }
    );
  }

  return (
    <div className="space-y-2">
      <DataTable<Supplier>
        loading={isLoading}
        data={data ?? []}
        exportName="suppliers"
        onRowOpen={(s) => openEdit(s)}
        toolbar={
          <button className="btn-primary" onClick={() => openEdit("new")}>
            <L k="new" />
          </button>
        }
        columns={[
          textCol("name", "name", (s) => s.name, 200),
          textCol("name_ps", "name_ps", (s) => s.name_ps, 160),
          textCol("country", "country", (s) => s.country, 100),
          textCol("contact", "contact", (s) => s.contact, 140),
          textCol("phone", "phone", (s) => s.phone, 120),
          {
            id: "active",
            header: () => <L k="is_active" />,
            accessorFn: (s) => (s.is_active ? "active" : "inactive"),
            cell: (c) => <StatusChip status={c.getValue() === "active" ? "posted" : "draft"} />,
            size: 90,
            meta: { csvHeader: "Active" },
          },
        ]}
      />

      {editing && (
        <div className="panel p-3 space-y-3">
          <div className="panel-title -mx-3 -mt-3 mb-2">
            <L k={editing === "new" ? "new" : "edit"} /> — <L k="supplier" />
          </div>
          <form
            onSubmit={handleSubmit((v) => save.mutate(v))}
            className="space-y-3"
          >
            <FieldGrid cols={3}>
              <Field k="name">
                <TextInput {...register("name", { required: true })} autoFocus />
              </Field>
              <Field k="name_ps">
                <TextInput {...register("name_ps")} className="font-pashto" />
              </Field>
              <Field k="country">
                <TextInput {...register("country")} />
              </Field>
              <Field k="contact">
                <TextInput {...register("contact")} />
              </Field>
              <Field k="phone">
                <TextInput {...register("phone")} />
              </Field>
              <Field k="address">
                <TextInput {...register("address")} />
              </Field>
            </FieldGrid>
            {error && <div className="text-status-reversed text-xs" dir="auto">{error}</div>}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={save.isPending}>
                <L k="save" />
              </button>
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
                <L k="cancel" />
              </button>
              {editing !== "new" && (
                <button
                  type="button"
                  className="btn-secondary ml-auto"
                  onClick={() => toggleActive.mutate(editing)}
                >
                  {editing.is_active ? <L k="inactive" /> : <L k="active" />}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
