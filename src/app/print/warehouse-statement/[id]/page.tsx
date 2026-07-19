"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { StatementPrint } from "@/components/print/StatementPrint";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { monthStartKabul, todayKabul } from "@/lib/dates";
import type { Warehouse } from "@/lib/types";

export default function PrintWarehouseStatement({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const search = useSearchParams();
  const { data: wh } = useQuery({
    queryKey: ["print_wh", id],
    queryFn: async () => {
      const { data, error } = await supabase().from("warehouses").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Warehouse;
    },
  });

  if (!wh) return <div className="text-ink-faint"><L k="loading" /></div>;
  return (
    <StatementPrint
      titleKey="report_warehouse_statement"
      partyName={wh.name}
      partyNamePs={wh.name_ps}
      accountId={wh.account_id}
      from={search.get("from") ?? monthStartKabul()}
      to={search.get("to") ?? todayKabul()}
    />
  );
}
