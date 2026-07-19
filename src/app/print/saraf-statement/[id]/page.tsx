"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { StatementPrint } from "@/components/print/StatementPrint";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { monthStartKabul, todayKabul } from "@/lib/dates";
import type { Saraf } from "@/lib/types";

export default function PrintSarafStatement({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const search = useSearchParams();
  const { data: saraf } = useQuery({
    queryKey: ["print_saraf", id],
    queryFn: async () => {
      const { data, error } = await supabase().from("sarafs").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Saraf;
    },
  });

  if (!saraf) return <div className="text-ink-faint"><L k="loading" /></div>;
  return (
    <StatementPrint
      titleKey="report_saraf_statement"
      partyName={saraf.name}
      partyNamePs={saraf.name_ps}
      accountId={saraf.account_id}
      from={search.get("from") ?? monthStartKabul()}
      to={search.get("to") ?? todayKabul()}
    />
  );
}
