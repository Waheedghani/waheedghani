"use client";

/** Keeper stock ledger: every movement of their own سرای. */
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/ui/DataTable";
import { dateCol, qtyCol, textCol } from "@/components/ui/cols";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { useVariants } from "@/lib/lookups";

interface MovementRow {
  id: string;
  movement_date: string;
  variant_id: string;
  movement_type: string;
  qty: string;
  notes: string | null;
}

export default function PortalStockPage() {
  const { profile } = useAuth();
  const variants = useVariants();
  const { data, isLoading } = useQuery({
    queryKey: ["portal_movements", profile?.warehouse_id],
    enabled: !!profile?.warehouse_id,
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("stock_movements")
        .select("*")
        .eq("warehouse_id", profile!.warehouse_id!)
        .order("seq", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as MovementRow[];
    },
  });

  const variantLabel = (id: string) => (variants.data ?? []).find((v) => v.id === id)?.label ?? "";

  return (
    <DataTable
      loading={isLoading}
      data={data ?? []}
      exportName="my-stock-ledger"
      columns={[
        dateCol<MovementRow>("movement_date", "date", (r) => r.movement_date),
        textCol<MovementRow>("variant", "variant", (r) => variantLabel(r.variant_id), 150),
        textCol<MovementRow>("movement_type", "movement_type", (r) => r.movement_type, 110),
        qtyCol<MovementRow>("qty", "quantity", (r) => r.qty),
        textCol<MovementRow>("notes", "note", (r) => r.notes, 260),
      ]}
    />
  );
}
