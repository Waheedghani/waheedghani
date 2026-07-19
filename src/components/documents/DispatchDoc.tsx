"use client";

/**
 * Dispatch invoice: authorization of goods to a سرای. On post the warehouse
 * account is debited (the warehouse is the debtor) and stock moves from
 * central to warehouse custody. Stock availability is enforced server-side.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DocumentShell } from "@/components/ui/DocumentShell";
import { AmountInput, CurrencySelect, DateInput, Field, FieldGrid, Select, TextInput } from "@/components/ui/fields";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useVariants, useWarehouses } from "@/lib/lookups";
import { D, fmtMoney, fmtQty, parseAmount, toMoneyString, toQtyString, type Currency } from "@/lib/money";
import { todayKabul } from "@/lib/dates";

interface LineDraft {
  variant_id: string;
  qty: string;
  price_per_unit: string;
}

export function DispatchDoc({ id }: { id: string | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const variants = useVariants();
  const [header, setHeader] = useState({
    dispatch_date: todayKabul(),
    warehouse_id: "",
    currency: "AFN" as Currency,
    fx_rate: "",
    notes: "",
  });
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: doc, refetch } = useQuery({
    queryKey: ["dispatch", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("dispatch_invoices")
        .select("*, warehouses(name, name_ps), dispatch_lines(*)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: stock } = useQuery({
    queryKey: ["central_stock"],
    queryFn: async () => {
      const { data, error } = await supabase().from("v_stock_levels").select("*").is("warehouse_id", null);
      if (error) throw error;
      return data as Array<{ variant_id: string; qty: string }>;
    },
  });

  useEffect(() => {
    if (!doc) return;
    setHeader({
      dispatch_date: doc.dispatch_date,
      warehouse_id: doc.warehouse_id,
      currency: doc.currency,
      fx_rate: doc.fx_rate ?? "",
      notes: doc.notes ?? "",
    });
    setLines(
      (doc.dispatch_lines as Array<Record<string, unknown>>).map((l) => ({
        variant_id: l.variant_id as string,
        qty: String(l.qty),
        price_per_unit: String(l.price_per_unit),
      }))
    );
  }, [doc]);

  const isDraft = !doc || doc.status === "draft";
  const lineTotal = (l: LineDraft) => (parseAmount(l.qty) ?? D(0)).mul(parseAmount(l.price_per_unit) ?? D(0));
  const grandTotal = lines.reduce((a, l) => a.plus(lineTotal(l)), D(0));
  const available = (vid: string) => stock?.find((s) => s.variant_id === vid)?.qty ?? "0";

  const save = useCallback(async (): Promise<string | null> => {
    setBusy(true);
    setError(null);
    try {
      const sb = supabase();
      const payload = {
        dispatch_date: header.dispatch_date,
        warehouse_id: header.warehouse_id || null,
        currency: header.currency,
        fx_rate: header.fx_rate || null,
        notes: header.notes || null,
      };
      let docId = id;
      if (!docId) {
        const { data, error } = await sb.from("dispatch_invoices").insert(payload).select("id").single();
        if (error) throw error;
        docId = data.id as string;
      } else {
        const { error } = await sb.from("dispatch_invoices").update(payload).eq("id", docId);
        if (error) throw error;
        const { error: delErr } = await sb.from("dispatch_lines").delete().eq("dispatch_id", docId);
        if (delErr) throw delErr;
      }
      if (lines.length > 0) {
        const { error } = await sb.from("dispatch_lines").insert(
          lines.map((l) => ({
            dispatch_id: docId,
            variant_id: l.variant_id,
            qty: toQtyString(parseAmount(l.qty) ?? D(0)),
            price_per_unit: toMoneyString(parseAmount(l.price_per_unit) ?? D(0)),
          }))
        );
        if (error) throw error;
      }
      await qc.invalidateQueries({ queryKey: ["dispatch_invoices"] });
      if (!id) router.replace(`/warehouses/dispatches/${docId}`);
      else await refetch();
      return docId;
    } catch (e) {
      setError(errMsg(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [header, lines, id, qc, refetch, router]);

  const post = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const docId = await save();
      if (!docId) return;
      const { error } = await supabase().rpc("fn_post_dispatch", { p_dispatch_id: docId });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["dispatch_invoices"] });
      await qc.invalidateQueries({ queryKey: ["central_stock"] });
      await refetch();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [save, qc, refetch]);

  return (
    <DocumentShell
      title={<L k="dispatch_invoices" />}
      status={doc?.status ?? "draft"}
      docNo={doc?.doc_no}
      newHref="/warehouses/dispatches/new"
      canSave={isDraft}
      canPost={isDraft && !!id}
      onSave={save}
      onPost={post}
      printHref={doc?.status === "posted" ? `/print/dispatch/${id}` : undefined}
      busy={busy}
      error={error}
      historyTable="dispatch_invoices"
      historyPk={id ?? undefined}
      createdBy={doc?.created_by ?? undefined}
      createdAt={doc?.created_at}
      postedBy={doc?.posted_by ?? undefined}
      postedAt={doc?.posted_at}
    >
      <div className="panel p-3 space-y-3">
        <FieldGrid cols={4}>
          <Field k="date">
            <DateInput disabled={!isDraft} value={header.dispatch_date}
              onChange={(e) => setHeader({ ...header, dispatch_date: e.target.value })} />
          </Field>
          <Field k="warehouse">
            <Select disabled={!isDraft} value={header.warehouse_id}
              onChange={(e) => setHeader({ ...header, warehouse_id: e.target.value })}>
              <option value="" />
              {(warehouses.data ?? []).filter((w) => w.is_active).map((w) => (
                <option key={w.id} value={w.id}>{w.name} / {w.name_ps}</option>
              ))}
            </Select>
          </Field>
          <Field k="currency">
            <CurrencySelect disabled={!isDraft} value={header.currency}
              onChange={(e) => setHeader({ ...header, currency: e.target.value as Currency })} />
          </Field>
          <Field k="exchange_rate">
            <AmountInput disabled={!isDraft} value={header.fx_rate}
              onChange={(e) => setHeader({ ...header, fx_rate: e.target.value })} />
          </Field>
          <Field k="note" span={4}>
            <TextInput disabled={!isDraft} value={header.notes}
              onChange={(e) => setHeader({ ...header, notes: e.target.value })} />
          </Field>
        </FieldGrid>

        <table className="erp-table">
          <thead>
            <tr>
              <th className="w-64"><L k="variant" /></th>
              <th className="w-28 text-right"><L k="stock" /></th>
              <th className="w-28 text-right"><L k="quantity" /></th>
              <th className="w-32 text-right"><L k="price_per_unit" /></th>
              <th className="w-32 text-right"><L k="line_total" /></th>
              {isDraft && <th className="w-16" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <Select disabled={!isDraft} value={l.variant_id}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, variant_id: e.target.value } : x)))}>
                    <option value="" />
                    {(variants.data ?? []).map((v) => (
                      <option key={v.id} value={v.id}>{v.products?.name} — {v.label}</option>
                    ))}
                  </Select>
                </td>
                <td className="num text-ink-faint">{fmtQty(available(l.variant_id))}</td>
                <td>
                  <AmountInput disabled={!isDraft} value={l.qty}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                </td>
                <td>
                  <AmountInput disabled={!isDraft} value={l.price_per_unit}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, price_per_unit: e.target.value } : x)))} />
                </td>
                <td className="num">{fmtMoney(lineTotal(l), header.currency)}</td>
                {isDraft && (
                  <td>
                    <button className="btn-secondary !h-5 !px-1.5"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                {isDraft && (
                  <button className="btn-secondary"
                    onClick={() => setLines((ls) => [...ls, { variant_id: "", qty: "", price_per_unit: "" }])}>
                    <L k="add_line" />
                  </button>
                )}
              </td>
              <td className="num">{fmtMoney(grandTotal, header.currency)}</td>
              {isDraft && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </DocumentShell>
  );
}
