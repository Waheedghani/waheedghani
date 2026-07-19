"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/ui/DataTable";
import { dateCol, qtyCol, statusCol, textCol } from "@/components/ui/cols";
import { supabase } from "@/lib/supabase/client";
import { useVariants } from "@/lib/lookups";

interface Row {
  id: string;
  doc_no: string;
  order_date: string;
  status: string;
  variant_id: string;
  qty_expected: string;
  qty_received: string;
  qty_waste: string;
  qty_remaining: string;
  trucks_total: number;
  trucks_received: number;
  trucks_remaining: number;
}

export default function OrderStatusReport() {
  const router = useRouter();
  const variants = useVariants();
  const { data, isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data, error } = await supabase().from("v_order_status").select("*").order("doc_no");
      if (error) throw error;
      return data as Row[];
    },
  });

  const variantLabel = (id: string) => (variants.data ?? []).find((v) => v.id === id)?.label ?? "";

  return (
    <DataTable<Row>
      loading={isLoading}
      data={data ?? []}
      exportName="order-status"
      onRowOpen={(r) => router.push(`/orders/${r.id}`)}
      columns={[
        textCol("doc_no", "doc_no", (r) => r.doc_no, 120),
        dateCol("order_date", "date", (r) => r.order_date),
        textCol("variant", "variant", (r) => variantLabel(r.variant_id), 140),
        qtyCol("qty_expected", "qty_expected", (r) => r.qty_expected),
        qtyCol("qty_received", "qty_received", (r) => r.qty_received),
        qtyCol("qty_waste", "waste", (r) => r.qty_waste),
        qtyCol("qty_remaining", "remaining", (r) => r.qty_remaining),
        qtyCol("trucks_received", "trucks_received", (r) => String(r.trucks_received)),
        qtyCol("trucks_remaining", "trucks_remaining", (r) => String(r.trucks_remaining)),
        statusCol((r) => r.status, 140),
      ]}
    />
  );
}
