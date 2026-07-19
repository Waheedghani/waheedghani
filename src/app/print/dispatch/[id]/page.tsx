"use client";

/** Printable dispatch/authorization invoice for the سرای. */
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { Letterhead, SignatureBlocks } from "@/components/print/Letterhead";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { fmtMoney, fmtQty, sumD, type Currency } from "@/lib/money";

interface Dispatch {
  id: string;
  doc_no: string;
  dispatch_date: string;
  currency: Currency;
  fx_rate: string | null;
  notes: string | null;
  warehouses: { name: string; name_ps: string; keeper_name: string | null } | null;
  dispatch_lines: Array<{
    qty: string;
    price_per_unit: string;
    line_total: string;
    product_variants: { label: string; label_ps: string; products: { name: string; name_ps: string } } | null;
  }>;
}

export default function PrintDispatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: d } = useQuery({
    queryKey: ["print_dispatch", id],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("dispatch_invoices")
        .select("id, doc_no, dispatch_date, currency, fx_rate, notes, warehouses(name, name_ps, keeper_name), dispatch_lines(qty, price_per_unit, line_total, product_variants(label, label_ps, products(name, name_ps)))")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as unknown as Dispatch;
    },
  });

  if (!d) return <div className="text-ink-faint"><L k="loading" /></div>;
  const total = sumD(d.dispatch_lines.map((l) => l.line_total));

  return (
    <div>
      <Letterhead titleKey="dispatch_invoices" date={d.dispatch_date} docNo={d.doc_no} />

      <div className="flex items-baseline justify-between text-sm mb-3">
        <span>
          <L k="warehouse" />: <strong>{d.warehouses?.name}</strong>{" "}
          <span dir="rtl" lang="ps" className="font-pashto font-bold">{d.warehouses?.name_ps}</span>
        </span>
        <span>
          <L k="keeper_name" />: {d.warehouses?.keeper_name ?? ""}
        </span>
      </div>

      <table className="erp-table">
        <thead>
          <tr>
            <th className="w-8">#</th>
            <th><L k="product" /></th>
            <th><L k="size" /></th>
            <th className="w-28 text-right"><L k="quantity" /></th>
            <th className="w-28 text-right"><L k="price" /></th>
            <th className="w-32 text-right"><L k="total" /></th>
          </tr>
        </thead>
        <tbody>
          {d.dispatch_lines.map((l, i) => (
            <tr key={i}>
              <td className="num">{i + 1}</td>
              <td>
                {l.product_variants?.products?.name}{" "}
                <span dir="rtl" lang="ps" className="font-pashto">{l.product_variants?.products?.name_ps}</span>
              </td>
              <td>
                {l.product_variants?.label}{" "}
                <span dir="rtl" lang="ps" className="font-pashto">{l.product_variants?.label_ps}</span>
              </td>
              <td className="num">{fmtQty(l.qty)}</td>
              <td className="num">{fmtMoney(l.price_per_unit, d.currency)}</td>
              <td className="num">{fmtMoney(l.line_total, d.currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} className="text-right font-semibold"><L k="total" /></td>
            <td className="num font-bold">{fmtMoney(total, d.currency)}</td>
          </tr>
        </tfoot>
      </table>

      {d.fx_rate && (
        <div className="text-sm mt-2">
          <L k="exchange_rate" />: <span className="num">{d.fx_rate}</span> AFN/USD
        </div>
      )}
      {d.notes && <div className="text-sm mt-1" dir="auto"><L k="note" />: {d.notes}</div>}

      <SignatureBlocks />
    </div>
  );
}
