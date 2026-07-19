"use client";

import { lbl } from "@/lib/labels";
/**
 * User management (admin). Creating a user: a secondary throwaway Supabase
 * client signs the new auth account up (so the admin's session is untouched),
 * then the profile row is inserted under the admin's RLS rights.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";
import { DataTable } from "@/components/ui/DataTable";
import { textCol } from "@/components/ui/cols";
import { Field, FieldGrid, Select, TextInput } from "@/components/ui/fields";
import { L } from "@/components/L";
import { StatusChip } from "@/components/StatusChip";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useWarehouses } from "@/lib/lookups";
import type { AppRole, AppUser } from "@/lib/types";

export default function UsersPage() {
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: "",
    password: "",
    full_name: "",
    role: "office" as AppRole,
    warehouse_id: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["app_users"],
    queryFn: async () => {
      const { data, error } = await supabase().from("app_users").select("*").order("full_name");
      if (error) throw error;
      return data as AppUser[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      // throwaway client: keeps the admin session intact
      const temp = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      const { data: signUp, error: suErr } = await temp.auth.signUp({
        email: form.email,
        password: form.password,
      });
      if (suErr) throw suErr;
      const newId = signUp.user?.id;
      if (!newId) throw new Error("auth user was not created (email confirmation may be required)");
      const { error } = await supabase().from("app_users").insert({
        id: newId,
        full_name: form.full_name,
        role: form.role,
        warehouse_id: form.role === "warehouse" ? form.warehouse_id : null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setError(null);
      setCreating(false);
      await qc.invalidateQueries({ queryKey: ["app_users"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  const toggleActive = useMutation({
    mutationFn: async (u: AppUser) => {
      const { error } = await supabase().from("app_users").update({ is_active: !u.is_active }).eq("id", u.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app_users"] }),
    onError: (e) => setError(errMsg(e)),
  });

  const whName = (id: string | null) => (warehouses.data ?? []).find((w) => w.id === id)?.name ?? "";

  return (
    <div className="space-y-2">
      {error && <div className="text-status-reversed text-xs" dir="auto">{error}</div>}
      <DataTable<AppUser>
        loading={isLoading}
        data={data ?? []}
        exportName="users"
        onRowOpen={(u) => toggleActive.mutate(u)}
        toolbar={
          <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
            <L k="new" />
          </button>
        }
        columns={[
          textCol("full_name", "full_name", (u) => u.full_name, 200),
          textCol("role", "role", (u) => u.role, 110),
          textCol("warehouse", "warehouse", (u) => whName(u.warehouse_id), 180),
          {
            id: "active",
            header: () => <L k="is_active" />,
            accessorFn: (u) => (u.is_active ? "active" : "inactive"),
            cell: (c) => <StatusChip status={c.getValue() === "active" ? "posted" : "draft"} />,
            size: 90,
            meta: { csvHeader: "Active" },
          },
        ]}
      />

      {creating && (
        <div className="panel p-3 space-y-3">
          <div className="panel-title -mx-3 -mt-3 mb-2"><L k="new" /> — <L k="user" /></div>
          <FieldGrid cols={4}>
            <Field k="email">
              <TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field k="password">
              <TextInput type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field k="full_name">
              <TextInput value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </Field>
            <Field k="role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AppRole })}>
                <option value="office">{lbl("office")}</option>
                <option value="warehouse">{lbl("warehouse")}</option>
                <option value="admin">{lbl("admin")}</option>
              </Select>
            </Field>
            {form.role === "warehouse" && (
              <Field k="warehouse">
                <Select value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
                  <option value="" />
                  {(warehouses.data ?? []).filter((w) => w.is_active).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </Select>
              </Field>
            )}
          </FieldGrid>
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={
                create.isPending || !form.email || form.password.length < 6 || !form.full_name ||
                (form.role === "warehouse" && !form.warehouse_id)
              }
              onClick={() => create.mutate()}
            >
              <L k="create" />
            </button>
            <button className="btn-secondary" onClick={() => setCreating(false)}><L k="cancel" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
