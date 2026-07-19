"use client";

/** Sarafs: list with live balances + create + per-saraf statement. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { DataTable } from "@/components/ui/DataTable";
import { textCol } from "@/components/ui/cols";
import { Field, FieldGrid, TextInput } from "@/components/ui/fields";
import { LedgerStatement } from "@/components/LedgerStatement";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useSarafs } from "@/lib/lookups";
import type { Saraf } from "@/lib/types";
import { fmtMoney, type Currency } from "@/lib/money";

export default function SarafsPage() {
  const { data, isLoading } = useSarafs();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [statementFor, setStatementFor] = useState<Saraf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset } = useForm<{ name: string; name_ps: string; phone: string; address: string }>();

  const { data: balances } = useQuery({
    queryKey: ["saraf_balances"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("v_account_balances")
        .select("account_id, currency, balance")
        .eq("type", "saraf");
      if (error) throw error;
      return data as Array<{ account_id: string; currency: Currency; balance: string }>;
    },
  });

  const bal = (s: Saraf, ccy: Currency) =>
    balances?.find((b) => b.account_id === s.account_id && b.currency === ccy)?.balance ?? "0";

  const save = useMutation({
    mutationFn: async (v: { name: string; name_ps: string; phone: string; address: string }) => {
      const { error } = await supabase().from("sarafs").insert(v);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["sarafs"] });
      setCreating(false);
      setError(null);
      reset();
    },
    onError: (e) => setError(errMsg(e)),
  });

  return (
    <div className="space-y-2">
      <DataTable<Saraf>
        loading={isLoading}
        data={data ?? []}
        exportName="sarafs"
        onRowOpen={(s) => setStatementFor(s)}
        toolbar={
          <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
            <L k="new" />
          </button>
        }
        columns={[
          textCol("name", "name", (s) => s.name, 200),
          textCol("name_ps", "name_ps", (s) => s.name_ps, 160),
          textCol("phone", "phone", (s) => s.phone, 130),
          {
            id: "bal_afn",
            header: () => <span className="block text-right"><L k="balance" /> AFN</span>,
            accessorFn: (s) => bal(s, "AFN"),
            cell: (c) => <span className="num block">{fmtMoney(c.getValue() as string, "AFN")}</span>,
            size: 130,
            enableColumnFilter: false,
            meta: { csvHeader: "Balance AFN" },
          },
          {
            id: "bal_usd",
            header: () => <span className="block text-right"><L k="balance" /> USD</span>,
            accessorFn: (s) => bal(s, "USD"),
            cell: (c) => <span className="num block">{fmtMoney(c.getValue() as string, "USD")}</span>,
            size: 130,
            enableColumnFilter: false,
            meta: { csvHeader: "Balance USD" },
          },
        ]}
      />

      {creating && (
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="panel p-3 space-y-3">
          <div className="panel-title -mx-3 -mt-3 mb-2"><L k="new" /> — <L k="saraf" /></div>
          <FieldGrid cols={4}>
            <Field k="name"><TextInput {...register("name", { required: true })} autoFocus /></Field>
            <Field k="name_ps"><TextInput {...register("name_ps")} className="font-pashto" /></Field>
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

      {statementFor && (
        <div className="panel p-3 space-y-2">
          <div className="panel-title -mx-3 -mt-3 mb-2 flex items-center justify-between">
            <span><L k="report_saraf_statement" /> — {statementFor.name}</span>
            <button className="btn-secondary" onClick={() => setStatementFor(null)}><L k="close" /></button>
          </div>
          <LedgerStatement accountId={statementFor.account_id} exportName={`saraf-${statementFor.name}`} />
        </div>
      )}
    </div>
  );
}
