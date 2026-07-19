"use client";

/** Data Health Dashboard (admin): status tiles per HC check, last run,
 *  one-click re-run, drill-down of offending rows. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { L } from "@/components/L";
import { StatusChip } from "@/components/StatusChip";
import { supabase } from "@/lib/supabase/client";
import { errMsg } from "@/lib/lookups";
import { fmtDateTime } from "@/lib/dates";

interface CheckRow {
  id: number;
  run_at: string;
  run_id: string;
  check_code: string;
  severity: "ok" | "warning" | "critical";
  title: string;
  details: Array<Record<string, unknown>>;
}

export default function DataHealthPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CheckRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["health_latest"],
    queryFn: async () => {
      const sb = supabase();
      const { data: latest, error: e1 } = await sb
        .from("data_health_results")
        .select("run_id")
        .order("id", { ascending: false })
        .limit(1);
      if (e1) throw e1;
      const runId = latest?.[0]?.run_id;
      if (!runId) return [] as CheckRow[];
      const { data, error } = await sb
        .from("data_health_results")
        .select("*")
        .eq("run_id", runId)
        .order("check_code");
      if (error) throw error;
      return data as CheckRow[];
    },
  });

  const rerun = useMutation({
    mutationFn: async () => {
      const { error } = await supabase().rpc("fn_run_health_checks");
      if (error) throw error;
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["health_latest"] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  const rows = data ?? [];

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-center gap-3">
        <span className="font-semibold text-lg"><L k="data_health" /></span>
        {rows[0] && (
          <span className="text-xs text-ink-soft">
            <L k="last_run" />: {fmtDateTime(rows[0].run_at)}
          </span>
        )}
        <button className="btn-primary ml-auto" disabled={rerun.isPending} onClick={() => rerun.mutate()}>
          <L k="run_checks" />
        </button>
        {error && <span className="text-status-reversed text-xs w-full" dir="auto">{error}</span>}
      </div>

      {isLoading ? (
        <div className="text-ink-faint"><L k="loading" /></div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {rows.map((r) => (
            <button
              key={r.check_code}
              onClick={() => setSelected(r)}
              className={`panel px-3 py-2 text-left hover:border-accent ${
                selected?.check_code === r.check_code ? "border-accent" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold">{r.check_code}</span>
                <StatusChip status={r.severity} />
              </div>
              <div className="text-xs text-ink-soft mt-1">{r.title}</div>
              <div className="text-xs mt-1 text-ink-faint">
                {r.details.length > 0 ? `${r.details.length} rows` : ""}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && selected.details.length > 0 && (
        <div className="panel p-2 overflow-auto">
          <div className="panel-title -m-2 mb-2">
            {selected.check_code} — {selected.title}
          </div>
          <table className="erp-table">
            <thead>
              <tr>
                {Object.keys(selected.details[0] ?? {}).map((k) => (
                  <th key={k} className="font-mono text-xs">{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selected.details.map((d, i) => (
                <tr key={i}>
                  {Object.keys(selected.details[0] ?? {}).map((k) => (
                    <td key={k} className="text-xs font-mono break-all" dir="auto">
                      {JSON.stringify(d[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
