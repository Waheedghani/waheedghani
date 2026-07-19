"use client";

import { lbl } from "@/lib/labels";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/ui/DataTable";
import { dateCol, statusCol, textCol } from "@/components/ui/cols";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import type { Currency } from "@/lib/money";

interface Row {
  id: string;
  doc_no: string | null;
  dispatch_date: string;
  currency: Currency;
  status: string;
  wh_confirmed_at: string | null;
  warehouses: { name: string; name_ps: string } | null;
}

export default function DispatchesPage() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ["dispatch_invoices"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("dispatch_invoices")
        .select("id, doc_no, dispatch_date, currency, status, wh_confirmed_at, warehouses(name, name_ps)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as unknown as Row[];
    },
  });

  return (
    <DataTable<Row>
      loading={isLoading}
      data={data ?? []}
      exportName="dispatches"
      onRowOpen={(r) => router.push(`/warehouses/dispatches/${r.id}`)}
      toolbar={
        <button className="btn-primary" onClick={() => router.push("/warehouses/dispatches/new")}>
          <L k="new" />
        </button>
      }
      columns={[
        textCol("doc_no", "doc_no", (r) => r.doc_no ?? `(${lbl("draft")})`, 120),
        dateCol("dispatch_date", "date", (r) => r.dispatch_date),
        textCol("warehouse", "warehouse", (r) => r.warehouses?.name, 200),
        textCol("warehouse_ps", "name_ps", (r) => r.warehouses?.name_ps, 140),
        textCol("currency", "currency", (r) => r.currency, 70),
        textCol("confirmed", "goods_received_confirm", (r) => (r.wh_confirmed_at ? "✓" : ""), 110),
        statusCol((r) => r.status),
      ]}
    />
  );
}
