"use client";

/** Audit log (admin): filter by table/user/date/record; old-new diff. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateInput, Field, FieldGrid, Select, TextInput } from "@/components/ui/fields";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { fmtDateTime, monthStartKabul, todayKabul } from "@/lib/dates";

interface AuditRow {
  id: number;
  at: string;
  user_email: string;
  table_name: string;
  row_pk: string;
  action: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
}

const TABLES = [
  "", "accounts", "journal_entries", "journal_lines", "suppliers", "warehouses", "sarafs",
  "products", "product_variants", "purchase_invoices", "purchase_invoice_lines",
  "supplier_payments", "orders", "truck_receipts", "order_expenses", "landed_costs",
  "stock_movements", "dispatch_invoices", "dispatch_lines", "warehouse_payments",
  "warehouse_pickups", "saraf_transactions", "roznamcha_manual", "roznamcha_days",
  "office_expenses", "expense_categories", "reconciliations", "app_users",
];

export default function AuditLogPage() {
  const [table, setTable] = useState("");
  const [email, setEmail] = useState("");
  const [rowPk, setRowPk] = useState("");
  const [from, setFrom] = useState(monthStartKabul());
  const [to, setTo] = useState(todayKabul());
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["audit_log", table, email, rowPk, from, to],
    queryFn: async () => {
      let q = supabase()
        .from("audit_log")
        .select("*")
        .gte("at", from)
        .lte("at", to + "T23:59:59Z")
        .order("id", { ascending: false })
        .limit(300);
      if (table) q = q.eq("table_name", table);
      if (email) q = q.ilike("user_email", `%${email}%`);
      if (rowPk) q = q.eq("row_pk", rowPk);
      const { data, error } = await q;
      if (error) throw error;
      return data as AuditRow[];
    },
  });

  function diffKeys(r: AuditRow): string[] {
    const keys = new Set([...Object.keys(r.old_row ?? {}), ...Object.keys(r.new_row ?? {})]);
    return [...keys].filter(
      (k) => JSON.stringify(r.old_row?.[k]) !== JSON.stringify(r.new_row?.[k])
    );
  }

  return (
    <div className="space-y-2">
      <div className="panel p-2">
        <FieldGrid cols={6}>
          <Field k="table">
            <Select value={table} onChange={(e) => setTable(e.target.value)}>
              {TABLES.map((t) => (
                <option key={t} value={t}>{t || "—"}</option>
              ))}
            </Select>
          </Field>
          <Field k="user">
            <TextInput value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field k="record">
            <TextInput value={rowPk} onChange={(e) => setRowPk(e.target.value)} />
          </Field>
          <Field k="from_date">
            <DateInput value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field k="to_date">
            <DateInput value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </FieldGrid>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <div className="panel overflow-auto max-h-[70vh]">
          <table className="erp-table">
            <thead>
              <tr>
                <th><L k="date" /></th><th><L k="user" /></th>
                <th><L k="table" /></th><th><L k="action" /></th><th><L k="record" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="text-center py-4 text-ink-faint"><L k="loading" /></td></tr>
              ) : (
                (data ?? []).map((r) => (
                  <tr key={r.id} onClick={() => setSelected(r)}
                    className={`cursor-pointer ${selected?.id === r.id ? "bg-accent-soft" : ""}`}>
                    <td className="num text-xs">{fmtDateTime(r.at)}</td>
                    <td className="text-xs">{r.user_email}</td>
                    <td className="font-mono text-xs">{r.table_name}</td>
                    <td className="text-xs">{r.action}</td>
                    <td className="font-mono text-xs truncate max-w-32">{r.row_pk}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="panel p-2 overflow-auto max-h-[70vh]">
          {selected ? (
            <table className="erp-table">
              <thead>
                <tr>
                  <th className="w-40"><L k="record" /></th>
                  <th><L k="old_value" /></th>
                  <th><L k="new_value" /></th>
                </tr>
              </thead>
              <tbody>
                {diffKeys(selected).map((k) => (
                  <tr key={k}>
                    <td className="font-mono text-xs">{k}</td>
                    <td className="text-xs text-status-reversed break-all whitespace-normal" dir="auto">
                      {JSON.stringify(selected.old_row?.[k])}
                    </td>
                    <td className="text-xs text-status-posted break-all whitespace-normal" dir="auto">
                      {JSON.stringify(selected.new_row?.[k])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-ink-faint text-center py-8"><L k="no_data" /></div>
          )}
        </div>
      </div>
    </div>
  );
}
