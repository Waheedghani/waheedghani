"use client";

/** Expense categories (admin): mapped to 6000-range accounts. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/ui/DataTable";
import { textCol } from "@/components/ui/cols";
import { Field, FieldGrid, Select, TextInput } from "@/components/ui/fields";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useExpenseCategories } from "@/lib/lookups";
import { useAuth } from "@/components/AuthProvider";

interface Cat {
  id: string;
  name: string;
  name_ps: string;
  account_id: string;
  is_active: boolean;
}

export default function ExpenseCategoriesPage() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const { data, isLoading } = useExpenseCategories();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", name_ps: "", account_id: "" });

  const { data: accounts } = useQuery({
    queryKey: ["expense_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("accounts")
        .select("id, code, name, name_ps")
        .eq("type", "office_expense")
        .order("code");
      if (error) throw error;
      return data as Array<{ id: string; code: string; name: string; name_ps: string }>;
    },
  });

  const accountLabel = (id: string) => {
    const a = accounts?.find((x) => x.id === id);
    return a ? `${a.code} ${a.name}` : "";
  };

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase().from("expense_categories").insert(form);
      if (error) throw error;
    },
    onSuccess: async () => {
      setError(null);
      setCreating(false);
      await qc.invalidateQueries({ queryKey: ["expense_categories"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  return (
    <div className="space-y-2">
      <DataTable
        loading={isLoading}
        data={data ?? []}
        exportName="expense-categories"
        toolbar={
          profile?.role === "admin" ? (
            <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
              <L k="new" />
            </button>
          ) : undefined
        }
        columns={[
          textCol<Cat>("name", "name", (c) => c.name, 180),
          textCol<Cat>("name_ps", "name_ps", (c) => c.name_ps, 160),
          textCol<Cat>("account", "account", (c) => accountLabel(c.account_id), 220),
        ]}
      />

      {creating && (
        <div className="panel p-3 space-y-3">
          <FieldGrid cols={3}>
            <Field k="name">
              <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field k="name_ps">
              <TextInput value={form.name_ps} className="font-pashto"
                onChange={(e) => setForm({ ...form, name_ps: e.target.value })} />
            </Field>
            <Field k="account">
              <Select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
                <option value="" />
                {(accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </Select>
            </Field>
          </FieldGrid>
          {error && <div className="text-status-reversed text-xs" dir="auto">{error}</div>}
          <div className="flex gap-2">
            <button className="btn-primary" disabled={create.isPending || !form.name || !form.account_id}
              onClick={() => create.mutate()}>
              <L k="save" />
            </button>
            <button className="btn-secondary" onClick={() => setCreating(false)}><L k="cancel" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
