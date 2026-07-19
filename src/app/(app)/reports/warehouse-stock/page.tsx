"use client";

/** Warehouse stock report: variants × warehouses matrix with company totals. */
import { useQuery } from "@tanstack/react-query";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { useVariants, useWarehouses } from "@/lib/lookups";
import { fmtQty, sumD } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { lblEn } from "@/lib/labels";

interface LevelRow {
  variant_id: string;
  warehouse_id: string | null;
  qty: string;
}

export default function WarehouseStockReport() {
  const variants = useVariants();
  const warehouses = useWarehouses();
  const { data } = useQuery({
    queryKey: ["stock_levels"],
    queryFn: async () => {
      const { data, error } = await supabase().from("v_stock_levels").select("*");
      if (error) throw error;
      return data as LevelRow[];
    },
  });

  const whs = (warehouses.data ?? []).filter((w) => w.is_active);
  const vars = variants.data ?? [];
  const qty = (variantId: string, warehouseId: string | null) =>
    (data ?? []).find((r) => r.variant_id === variantId && r.warehouse_id === warehouseId)?.qty ?? "0";
  const rowTotal = (variantId: string) =>
    sumD((data ?? []).filter((r) => r.variant_id === variantId).map((r) => r.qty));

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-center gap-3 no-print">
        <span className="font-semibold text-lg"><L k="report_warehouse_stock" /></span>
        <button
          className="btn-secondary ml-auto"
          onClick={() =>
            downloadCsv(
              "warehouse-stock.csv",
              [lblEn("variant"), lblEn("central_stock"), ...whs.map((w) => w.name), lblEn("total")],
              vars.map((v) => [
                `${v.products?.name} ${v.label}`,
                qty(v.id, null),
                ...whs.map((w) => qty(v.id, w.id)),
                rowTotal(v.id).toFixed(3),
              ])
            )
          }
        >
          <L k="export_csv" />
        </button>
        <button className="btn-secondary" onClick={() => window.print()}><L k="print" /></button>
      </div>

      <div className="panel overflow-auto">
        <table className="erp-table">
          <thead>
            <tr>
              <th><L k="variant" /></th>
              <th className="text-right"><L k="central_stock" /></th>
              {whs.map((w) => (
                <th key={w.id} className="text-right">
                  {w.name} <span dir="rtl" lang="ps" className="font-pashto">{w.name_ps}</span>
                </th>
              ))}
              <th className="text-right"><L k="total" /></th>
            </tr>
          </thead>
          <tbody>
            {vars.map((v) => (
              <tr key={v.id}>
                <td>{v.products?.name} — {v.label}</td>
                <td className="num">{fmtQty(qty(v.id, null))}</td>
                {whs.map((w) => (
                  <td key={w.id} className="num">{fmtQty(qty(v.id, w.id))}</td>
                ))}
                <td className="num font-semibold">{fmtQty(rowTotal(v.id))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
