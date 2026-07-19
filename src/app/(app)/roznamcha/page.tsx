"use client";

import { lbl } from "@/lib/labels";
/**
 * Roznamcha (روزنامچه): the daily physical-cash book. Opening balance row,
 * every cash entry of the day with running AFN/USD balances, closing row,
 * manual in/out entries, "Close Day" workflow with variance enforcement,
 * printable daily sheet.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { L } from "@/components/L";
import { StatusChip } from "@/components/StatusChip";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AmountInput, CurrencySelect, DateInput, Field, FieldGrid, Select, TextInput } from "@/components/ui/fields";
import { supabase } from "@/lib/supabase/client";
import { errMsg } from "@/lib/lookups";
import { todayKabul } from "@/lib/dates";
import { D, fmtMoney, parseAmount, toMoneyString, type Currency } from "@/lib/money";

interface SheetRow {
  row_kind: "opening" | "entry" | "closing";
  entry_no: number | null;
  source_type: string | null;
  description: string;
  description_ps: string;
  bill_refs: string;
  afn_in: string | null;
  afn_out: string | null;
  usd_in: string | null;
  usd_out: string | null;
  run_afn: string;
  run_usd: string;
}

export default function RoznamchaPage() {
  const qc = useQueryClient();
  const [day, setDay] = useState(todayKabul());
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [confirmManualId, setConfirmManualId] = useState<string | null>(null);
  const [manual, setManual] = useState({
    direction: "in" as "in" | "out",
    currency: "AFN" as Currency,
    amount: "",
    description: "",
    description_ps: "",
    bill_refs: "",
    qty_note: "",
  });
  const [closeForm, setCloseForm] = useState({ counted_afn: "", counted_usd: "", explanation: "" });

  const { data: sheet, isLoading } = useQuery({
    queryKey: ["roznamcha_sheet", day],
    queryFn: async () => {
      const { data, error } = await supabase().rpc("fn_roznamcha_sheet", { p_date: day });
      if (error) throw error;
      return data as SheetRow[];
    },
  });

  const { data: dayStatus } = useQuery({
    queryKey: ["roznamcha_day", day],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("roznamcha_days")
        .select("*")
        .eq("day_date", day)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: manualDrafts } = useQuery({
    queryKey: ["roznamcha_manual", day],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("roznamcha_manual")
        .select("*")
        .eq("entry_date", day)
        .eq("status", "draft");
      if (error) throw error;
      return data as Array<Record<string, unknown>>;
    },
  });

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["roznamcha_sheet", day] });
    await qc.invalidateQueries({ queryKey: ["roznamcha_day", day] });
    await qc.invalidateQueries({ queryKey: ["roznamcha_manual", day] });
  };

  const addManual = useMutation({
    mutationFn: async () => {
      const { error } = await supabase().from("roznamcha_manual").insert({
        entry_date: day,
        description: manual.description,
        description_ps: manual.description_ps,
        direction: manual.direction,
        currency: manual.currency,
        amount: toMoneyString(parseAmount(manual.amount) ?? D(0)),
        bill_refs: manual.bill_refs.split(",").map((s) => s.trim()).filter(Boolean),
        qty_note: manual.qty_note || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => { setError(null); setShowManual(false); await invalidate(); },
    onError: (e) => setError(errMsg(e)),
  });

  const postManual = useMutation({
    mutationFn: async (mid: string) => {
      const { error } = await supabase().rpc("fn_post_roznamcha_manual", { p_id: mid });
      if (error) throw error;
    },
    onSuccess: async () => { setError(null); await invalidate(); },
    onError: (e) => setError(errMsg(e)),
  });

  const closeDay = useMutation({
    mutationFn: async () => {
      const { error } = await supabase().rpc("fn_close_roznamcha_day", {
        p_date: day,
        p_counted_afn: toMoneyString(parseAmount(closeForm.counted_afn) ?? D(0)),
        p_counted_usd: toMoneyString(parseAmount(closeForm.counted_usd) ?? D(0)),
        p_explanation: closeForm.explanation || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => { setError(null); setShowClose(false); await invalidate(); },
    onError: (e) => setError(errMsg(e)),
  });

  const rows = sheet ?? [];
  const closing = rows.find((r) => r.row_kind === "closing");
  const isClosed = dayStatus?.status === "closed";

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-center gap-3 flex-wrap no-print">
        <span className="font-semibold text-lg"><L k="roznamcha" /></span>
        <DateInput value={day} onChange={(e) => setDay(e.target.value)} />
        {isClosed ? <StatusChip status="closed" /> : <StatusChip status="open" />}
        <span className="text-xs text-ink-faint"><L k="saraf_not_in_roznamcha" /></span>
        <div className="ml-auto flex gap-2">
          <button className="btn-secondary" onClick={() => setShowManual((v) => !v)} disabled={isClosed}>
            <L k="new" />
          </button>
          <button className="btn-secondary" onClick={() => window.open(`/print/roznamcha/${day}`, "_blank")}>
            <L k="print" />
          </button>
          <button className="btn-primary" onClick={() => setShowClose(true)} disabled={isClosed}>
            <L k="close_day" />
          </button>
        </div>
        {error && <div className="w-full text-status-reversed text-xs" dir="auto">{error}</div>}
      </div>

      {(manualDrafts ?? []).length > 0 && (
        <div className="panel p-2 space-y-1">
          <div className="text-xs font-medium text-ink-soft"><L k="draft" /> — <L k="roznamcha" /></div>
          {(manualDrafts ?? []).map((m) => (
            <div key={String(m.id)} className="flex items-center gap-3 text-xs">
              <span dir="auto">{String(m.description)}</span>
              <span className="num">{fmtMoney(String(m.amount), m.currency as Currency)}</span>
              <span>{String(m.direction) === "in" ? "↓" : "↑"}</span>
              <button className="btn-primary !h-5" onClick={() => setConfirmManualId(String(m.id))}>
                <L k="post" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showManual && (
        <div className="panel p-3 space-y-3">
          <FieldGrid cols={6}>
            <Field k="direction">
              <Select value={manual.direction} onChange={(e) => setManual({ ...manual, direction: e.target.value as "in" | "out" })}>
                <option value="in">{lbl("cash_in")}</option>
                <option value="out">{lbl("cash_out")}</option>
              </Select>
            </Field>
            <Field k="currency">
              <CurrencySelect value={manual.currency} onChange={(e) => setManual({ ...manual, currency: e.target.value as Currency })} />
            </Field>
            <Field k="amount">
              <AmountInput value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} />
            </Field>
            <Field k="description" span={2}>
              <TextInput value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} />
            </Field>
            <Field k="bill_refs">
              <TextInput value={manual.bill_refs} onChange={(e) => setManual({ ...manual, bill_refs: e.target.value })} />
            </Field>
            <Field k="quantity">
              <TextInput value={manual.qty_note} onChange={(e) => setManual({ ...manual, qty_note: e.target.value })} />
            </Field>
          </FieldGrid>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={addManual.isPending || !manual.description || !parseAmount(manual.amount)}
              onClick={() => addManual.mutate()}>
              <L k="save" />
            </button>
            <button className="btn-secondary" onClick={() => setShowManual(false)}><L k="cancel" /></button>
          </div>
        </div>
      )}

      <div className="panel overflow-auto">
        <table className="erp-table">
          <thead>
            <tr>
              <th className="w-16"><L k="entry_no" /></th>
              <th><L k="description" /></th>
              <th className="w-28"><L k="bill_refs" /></th>
              <th className="w-28 text-right">AFN <L k="cash_in" /></th>
              <th className="w-28 text-right">AFN <L k="cash_out" /></th>
              <th className="w-28 text-right">AFN <L k="running_balance" /></th>
              <th className="w-28 text-right">USD <L k="cash_in" /></th>
              <th className="w-28 text-right">USD <L k="cash_out" /></th>
              <th className="w-28 text-right">USD <L k="running_balance" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="text-center py-4 text-ink-faint"><L k="loading" /></td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className={r.row_kind !== "entry" ? "bg-surface-sunken font-semibold" : undefined}>
                  <td className="num">{r.entry_no ?? ""}</td>
                  <td>
                    <span dir="auto">{r.description}</span>{" "}
                    {r.description_ps && (
                      <span dir="rtl" lang="ps" className="font-pashto text-ink-soft">{r.description_ps}</span>
                    )}
                  </td>
                  <td dir="auto" className="text-xs">{r.bill_refs}</td>
                  <td className="num">{r.afn_in ? fmtMoney(r.afn_in) : ""}</td>
                  <td className="num">{r.afn_out ? fmtMoney(r.afn_out) : ""}</td>
                  <td className="num font-medium">{fmtMoney(r.run_afn, "AFN")}</td>
                  <td className="num">{r.usd_in ? fmtMoney(r.usd_in) : ""}</td>
                  <td className="num">{r.usd_out ? fmtMoney(r.usd_out) : ""}</td>
                  <td className="num font-medium">{fmtMoney(r.run_usd, "USD")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isClosed && dayStatus && (
        <div className="panel p-3 grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
          <div><div className="text-ink-soft"><L k="counted" /> AFN</div><div className="num font-semibold">{fmtMoney(dayStatus.counted_afn, "AFN")}</div></div>
          <div><div className="text-ink-soft"><L k="computed" /> AFN</div><div className="num font-semibold">{fmtMoney(dayStatus.computed_afn, "AFN")}</div></div>
          <div><div className="text-ink-soft"><L k="variance" /> AFN</div><div className="num font-semibold">{fmtMoney(dayStatus.variance_afn, "AFN")}</div></div>
          <div><div className="text-ink-soft"><L k="counted" /> USD</div><div className="num font-semibold">{fmtMoney(dayStatus.counted_usd, "USD")}</div></div>
          <div><div className="text-ink-soft"><L k="computed" /> USD</div><div className="num font-semibold">{fmtMoney(dayStatus.computed_usd, "USD")}</div></div>
          <div><div className="text-ink-soft"><L k="variance" /> USD</div><div className="num font-semibold">{fmtMoney(dayStatus.variance_usd, "USD")}</div></div>
          {dayStatus.variance_explanation && (
            <div className="col-span-full" dir="auto">
              <span className="text-ink-soft"><L k="variance_explanation" />:</span> {dayStatus.variance_explanation}
            </div>
          )}
        </div>
      )}

      {showClose && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center no-print">
          <div className="panel w-[460px] p-4 space-y-3 shadow-xl">
            <div className="font-semibold"><L k="close_day" /> — {day}</div>
            <div className="text-xs text-ink-soft"><L k="day_close_warning" /></div>
            <div className="text-xs">
              <L k="computed" />: {closing ? `${fmtMoney(closing.run_afn, "AFN")} · ${fmtMoney(closing.run_usd, "USD")}` : "…"}
            </div>
            <FieldGrid cols={2}>
              <Field k="counted">
                <AmountInput placeholder="AFN" value={closeForm.counted_afn}
                  onChange={(e) => setCloseForm({ ...closeForm, counted_afn: e.target.value })} />
              </Field>
              <Field k="counted">
                <AmountInput placeholder="USD" value={closeForm.counted_usd}
                  onChange={(e) => setCloseForm({ ...closeForm, counted_usd: e.target.value })} />
              </Field>
            </FieldGrid>
            <Field k="variance_explanation">
              <TextInput value={closeForm.explanation}
                onChange={(e) => setCloseForm({ ...closeForm, explanation: e.target.value })} />
            </Field>
            <div className="text-xs text-ink-faint"><L k="variance_must_be_explained" /></div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowClose(false)}><L k="cancel" /></button>
              <button className="btn-primary"
                disabled={
                  closeDay.isPending ||
                  parseAmount(closeForm.counted_afn) === null ||
                  parseAmount(closeForm.counted_usd) === null
                }
                onClick={() => closeDay.mutate()}>
                <L k="close_day" />
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmManualId}
        titleKey="confirm_post_title"
        bodyKey="posting_permanent"
        onConfirm={() => {
          if (confirmManualId) postManual.mutate(confirmManualId);
          setConfirmManualId(null);
        }}
        onCancel={() => setConfirmManualId(null)}
      />
    </div>
  );
}
