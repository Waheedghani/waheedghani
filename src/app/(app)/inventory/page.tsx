"use client";

/** Stock overview: central + per-warehouse quantities per variant. */
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/ui/DataTable";
import { qtyCol, textCol } from "@/components/ui/cols";
import { supabase } from "@/lib/supabase/client";
import { useVariants, useWarehouses } from "@/lib/lookups";
import { lblEn } from "@/lib/labels";
import { sumD, fmtQty } from "@/lib/money";

interface LevelRow {
  variant_id: string;
  warehouse_id: string | null;
  qty: string;
}

interface StockRow extends LevelRow {
  product: string;
  variant: string;
  location: string;
  location_ps: string;
}

export default function InventoryPage() {
  const variants = useVariants();
  const warehouses = useWarehouses();
  const { data, isLoading } = useQuery({
    queryKey: ["stock_levels"],
    queryFn: async () => {
      const { data, error } = await supabase().from("v_stock_levels").select("*");
      if (error) throw error;
      return data as LevelRow[];
    },
  });

  const rows: StockRow[] = (data ?? []).map((r) => {
    const v = (variants.data ?? []).find((x) => x.id === r.variant_id);
    const w = (warehouses.data ?? []).find((x) => x.id === r.warehouse_id);
    return {
      ...r,
      product: v?.products?.name ?? "",
      variant: v?.label ?? "",
      location: r.warehouse_id === null ? lblEn("central_stock") : (w?.name ?? ""),
      location_ps: r.warehouse_id === null ? "" : (w?.name_ps ?? ""),
    };
  });

  return (
    <DataTable
      loading={isLoading || variants.isLoading}
      data={rows}
      exportName="stock-levels"
      totals={{ qty: fmtQty(sumD(rows.map((r) => r.qty))) }}
      columns={[
        textCol<StockRow>("product", "product", (r) => r.product, 140),
        textCol<StockRow>("variant", "variant", (r) => r.variant, 140),
        textCol<StockRow>("location", "warehouse", (r) => r.location, 200),
        textCol<StockRow>("location_ps", "name_ps", (r) => r.location_ps, 140),
        qtyCol<StockRow>("qty", "stock", (r) => r.qty, 120),
      ]}
    />
  );
}
