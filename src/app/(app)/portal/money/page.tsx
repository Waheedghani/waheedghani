"use client";

/** Keeper money ledger — their own سرای account statement. */
import { useQuery } from "@tanstack/react-query";
import { LedgerStatement } from "@/components/LedgerStatement";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import type { Warehouse } from "@/lib/types";

export default function PortalMoneyPage() {
  const { profile } = useAuth();
  const { data: wh } = useQuery({
    queryKey: ["portal_wh", profile?.warehouse_id],
    enabled: !!profile?.warehouse_id,
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("warehouses")
        .select("*")
        .eq("id", profile!.warehouse_id!)
        .single();
      if (error) throw error;
      return data as Warehouse;
    },
  });

  if (!wh) return <div className="text-ink-faint"><L k="loading" /></div>;
  return <LedgerStatement accountId={wh.account_id} exportName="my-money-ledger" />;
}
