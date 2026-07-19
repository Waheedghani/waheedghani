"use client";

/** Audit trail for one record (admin only): who/when/action + field diff. */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { L } from "@/components/L";
import { fmtDateTime } from "@/lib/dates";

interface AuditRow {
  id: number;
  at: string;
  user_email: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
}

function changedKeys(oldRow: Record<string, unknown> | null, newRow: Record<string, unknown> | null): string[] {
  const keys = new Set([...Object.keys(oldRow ?? {}), ...Object.keys(newRow ?? {})]);
  const out: string[] = [];
  for (const k of keys) {
    if (k === "updated_at" || k === "updated_by") continue;
    if (JSON.stringify(oldRow?.[k]) !== JSON.stringify(newRow?.[k])) out.push(k);
  }
  return out;
}

export function HistoryDrawer({ table, pk, onClose }: { table: string; pk: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["audit", table, pk],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("audit_log")
        .select("id, at, user_email, action, old_row, new_row")
        .eq("table_name", table)
        .eq("row_pk", pk)
        .order("id", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as AuditRow[];
    },
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex justify-end no-print" onClick={onClose}>
      <div
        className="bg-white w-[560px] h-full overflow-auto border-l border-line p-3 space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold">
            <L k="history" />
          </span>
          <button className="btn-secondary" onClick={onClose}>
            <L k="close" />
          </button>
        </div>
        {isLoading && (
          <div className="text-ink-faint">
            <L k="loading" />
          </div>
        )}
        {(data ?? []).map((r) => {
          const diff = changedKeys(r.old_row, r.new_row);
          return (
            <div key={r.id} className="border border-line-soft rounded-[3px] p-2 text-xs space-y-1">
              <div className="flex gap-2 text-ink-soft">
                <span className="font-medium text-ink">{r.action}</span>
                <span>{fmtDateTime(r.at)}</span>
                <span>{r.user_email}</span>
              </div>
              {r.action === "UPDATE" ? (
                <table className="w-full">
                  <tbody>
                    {diff.map((k) => (
                      <tr key={k} className="border-t border-line-soft">
                        <td className="font-mono pr-2 py-0.5 align-top w-36">{k}</td>
                        <td className="text-status-reversed align-top break-all" dir="auto">
                          {JSON.stringify(r.old_row?.[k])}
                        </td>
                        <td className="text-status-posted align-top break-all" dir="auto">
                          {JSON.stringify(r.new_row?.[k])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-ink-faint break-all" dir="auto">
                  {JSON.stringify(r.new_row ?? r.old_row)?.slice(0, 400)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
