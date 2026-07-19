"use client";

/**
 * Purchase invoice document screen: header field grid, line-items table with
 * inline edit and live (display-only) totals, draft->post workflow.
 * The server recomputes and validates all totals on post.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DocumentShell } from "@/components/ui/DocumentShell";
import { AmountInput, CurrencySelect, DateInput, Field, FieldGrid, Select, TextInput } from "@/components/ui/fields";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { errMsg, useSuppliers, useVariants } from "@/lib/lookups";
import { D, fmtMoney, parseAmount, toMoneyString, type Currency } from "@/lib/money";
import { todayKabul } from "@/lib/dates";
import { lbl } from "@/lib/labels";

interface LineDraft {
  id?: string;
  variant_id: string;
  containers_count: string;
  units_per_container: string;
  price_per_unit: string;
  container_numbers: string; // comma-separated in the editor
}

interface HeaderDraft {
  invoice_date: string;
  supplier_id: string;
  invoice_number_supplier: string;
  bill_of_lading: string;
  bank_name: string;
  currency: Currency;
  advance_payment: string;
  bank_balance_due: string;
  notes: string;
}

const emptyHeader = (): HeaderDraft => ({
  invoice_date: todayKabul(),
  supplier_id: "",
  invoice_number_supplier: "",
  bill_of_lading: "",
  bank_name: "",
  currency: "USD",
  advance_payment: "0",
  bank_balance_due: "0",
  notes: "",
});

export function PurchaseInvoiceDoc({ id }: { id: string | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const suppliers = useSuppliers();
  const variants = useVariants();
  const [header, setHeader] = useState<HeaderDraft>(emptyHeader());
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: doc, refetch } = useQuery({
    queryKey: ["purchase_invoice", id],
    enabled: !!id,
    queryFn: async () => {
      const sb = supabase();
      const { data, error } = await sb
        .from("purchase_invoices")
        .select("*, suppliers(name), purchase_invoice_lines(*)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!doc) return;
    setHeader({
      invoice_date: doc.invoice_date,
      supplier_id: doc.supplier_id,
      invoice_number_supplier: doc.invoice_number_supplier ?? "",
      bill_of_lading: doc.bill_of_lading ?? "",
      bank_name: doc.bank_name ?? "",
      currency: doc.currency,
      advance_payment: doc.advance_payment,
      bank_balance_due: doc.bank_balance_due,
      notes: doc.notes ?? "",
    });
    setLines(
      (doc.purchase_invoice_lines as Array<Record<string, unknown>>).map((l) => ({
        id: l.id as string,
        variant_id: l.variant_id as string,
        containers_count: String(l.containers_count),
        units_per_container: String(l.units_per_container),
        price_per_unit: String(l.price_per_unit),
        container_numbers: ((l.container_numbers as string[]) ?? []).join(", "),
      }))
    );
  }, [doc]);

  const isDraft = !doc || doc.status === "draft";

  const lineTotal = (l: LineDraft) => {
    const c = parseAmount(l.containers_count);
    const u = parseAmount(l.units_per_container);
    const p = parseAmount(l.price_per_unit);
    if (!c || !u || !p) return D(0);
    return c.mul(u).mul(p);
  };
  const grandTotal = lines.reduce((acc, l) => acc.plus(lineTotal(l)), D(0));

  const save = useCallback(async (): Promise<string | null> => {
    setBusy(true);
    setError(null);
    try {
      const sb = supabase();
      const payload = {
        invoice_date: header.invoice_date,
        supplier_id: header.supplier_id || null,
        invoice_number_supplier: header.invoice_number_supplier || null,
        bill_of_lading: header.bill_of_lading || null,
        bank_name: header.bank_name || null,
        currency: header.currency,
        advance_payment: toMoneyString(parseAmount(header.advance_payment) ?? D(0)),
        bank_balance_due: toMoneyString(parseAmount(header.bank_balance_due) ?? D(0)),
        notes: header.notes || null,
      };
      let invId = id;
      if (!invId) {
        const { data, error } = await sb.from("purchase_invoices").insert(payload).select("id").single();
        if (error) throw error;
        invId = data.id as string;
      } else {
        const { error } = await sb.from("purchase_invoices").update(payload).eq("id", invId);
        if (error) throw error;
        const { error: delErr } = await sb.from("purchase_invoice_lines").delete().eq("invoice_id", invId);
        if (delErr) throw delErr;
      }
      if (lines.length > 0) {
        const { error } = await sb.from("purchase_invoice_lines").insert(
          lines.map((l) => ({
            invoice_id: invId,
            variant_id: l.variant_id,
            containers_count: Number.parseInt(l.containers_count, 10),
            units_per_container: l.units_per_container,
            price_per_unit: toMoneyString(parseAmount(l.price_per_unit) ?? D(0)),
            container_numbers: l.container_numbers
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          }))
        );
        if (error) throw error;
      }
      await qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      if (!id) router.replace(`/purchasing/invoices/${invId}`);
      else await refetch();
      return invId;
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
      const invId = await save();
      if (!invId) return;
      const { error } = await supabase().rpc("fn_post_purchase_invoice", { p_invoice_id: invId });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      await refetch();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [save, qc, refetch]);

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  return (
    <DocumentShell
      title={<L k="purchase_invoices" />}
      status={doc?.status ?? "draft"}
      docNo={doc?.doc_no}
      newHref="/purchasing/invoices/new"
      canSave={isDraft}
      canPost={isDraft && !!id}
      onSave={save}
      onPost={post}
      busy={busy}
      error={error}
      historyTable="purchase_invoices"
      historyPk={id ?? undefined}
      createdBy={doc?.created_by ?? undefined}
      createdAt={doc?.created_at}
      postedBy={doc?.posted_by ?? undefined}
      postedAt={doc?.posted_at}
    >
      <div className="panel p-3 space-y-3">
        <FieldGrid cols={4}>
          <Field k="date">
            <DateInput
              disabled={!isDraft}
              value={header.invoice_date}
              onChange={(e) => setHeader({ ...header, invoice_date: e.target.value })}
            />
          </Field>
          <Field k="supplier">
            <Select
              disabled={!isDraft}
              value={header.supplier_id}
              onChange={(e) => setHeader({ ...header, supplier_id: e.target.value })}
            >
              <option value="" />
              {(suppliers.data ?? []).filter((s) => s.is_active).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.name_ps ? `/ ${s.name_ps}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field k="supplier_invoice_no">
            <TextInput
              disabled={!isDraft}
              value={header.invoice_number_supplier}
              onChange={(e) => setHeader({ ...header, invoice_number_supplier: e.target.value })}
            />
          </Field>
          <Field k="bill_of_lading">
            <TextInput
              disabled={!isDraft}
              value={header.bill_of_lading}
              onChange={(e) => setHeader({ ...header, bill_of_lading: e.target.value })}
            />
          </Field>
          <Field k="bank_name">
            <TextInput
              disabled={!isDraft}
              value={header.bank_name}
              onChange={(e) => setHeader({ ...header, bank_name: e.target.value })}
            />
          </Field>
          <Field k="currency">
            <CurrencySelect
              disabled={!isDraft}
              value={header.currency}
              onChange={(e) => setHeader({ ...header, currency: e.target.value as Currency })}
            />
          </Field>
          <Field k="advance_payment">
            <AmountInput
              disabled={!isDraft}
              value={header.advance_payment}
              onChange={(e) => setHeader({ ...header, advance_payment: e.target.value })}
            />
          </Field>
          <Field k="bank_balance_due">
            <AmountInput
              disabled={!isDraft}
              value={header.bank_balance_due}
              onChange={(e) => setHeader({ ...header, bank_balance_due: e.target.value })}
            />
          </Field>
          <Field k="note" span={4}>
            <TextInput
              disabled={!isDraft}
              value={header.notes}
              onChange={(e) => setHeader({ ...header, notes: e.target.value })}
            />
          </Field>
        </FieldGrid>

        <table className="erp-table">
          <thead>
            <tr>
              <th className="w-56"><L k="variant" /></th>
              <th className="w-28 text-right"><L k="containers_count" /></th>
              <th className="w-32 text-right"><L k="bottles_per_container" /></th>
              <th className="w-28 text-right"><L k="price_per_unit" /></th>
              <th><L k="container_no" /></th>
              <th className="w-32 text-right"><L k="line_total" /></th>
              {isDraft && <th className="w-16" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <Select
                    disabled={!isDraft}
                    value={l.variant_id}
                    onChange={(e) => setLine(i, { variant_id: e.target.value })}
                  >
                    <option value="" />
                    {(variants.data ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.products?.name} — {v.label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td>
                  <AmountInput disabled={!isDraft} value={l.containers_count}
                    onChange={(e) => setLine(i, { containers_count: e.target.value })} />
                </td>
                <td>
                  <AmountInput disabled={!isDraft} value={l.units_per_container}
                    onChange={(e) => setLine(i, { units_per_container: e.target.value })} />
                </td>
                <td>
                  <AmountInput disabled={!isDraft} value={l.price_per_unit}
                    onChange={(e) => setLine(i, { price_per_unit: e.target.value })} />
                </td>
                <td>
                  <TextInput disabled={!isDraft} value={l.container_numbers}
                    placeholder={lbl("container_no")}
                    onChange={(e) => setLine(i, { container_numbers: e.target.value })} />
                </td>
                <td className="num">{fmtMoney(lineTotal(l), header.currency)}</td>
                {isDraft && (
                  <td>
                    <button className="btn-secondary !h-5 !px-1.5"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>
                {isDraft && (
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      setLines((ls) => [
                        ...ls,
                        { variant_id: "", containers_count: "1", units_per_container: "1150", price_per_unit: "0", container_numbers: "" },
                      ])
                    }
                  >
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
