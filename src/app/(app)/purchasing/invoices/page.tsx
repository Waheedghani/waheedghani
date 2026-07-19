"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/ui/DataTable";
import { dateCol, moneyCol, statusCol, textCol } from "@/components/ui/cols";
import { L } from "@/components/L";
import { supabase } from "@/lib/supabase/client";
import { fmtMoney, sumD, type Currency } from "@/lib/money";

interface Row {
  id: string;
  doc_no: string | null;
  invoice_date: string;
  currency: Currency;
  advance_payment: string;
  bank_balance_due: string;
  total_amount: string;
  bank_name: string | null;
  bill_of_lading: string | null;
  invoice_number_supplier: string | null;
  status: string;
  suppliers: { name: string; name_ps: string } | null;
}

export default function PurchaseInvoicesPage() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ["purchase_invoices"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("purchase_invoices")
        .select("id, doc_no, invoice_date, currency, advance_payment, bank_balance_due, total_amount, bank_name, bill_of_lading, invoice_number_supplier, status, suppliers(name, name_ps)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as unknown as Row[];
    },
  });

  const rows = data ?? [];

  return (
    <DataTable<Row>
      loading={isLoading}
      data={rows}
      exportName="purchase-invoices"
      onRowOpen={(r) => router.push(`/purchasing/invoices/${r.id}`)}
      toolbar={
        <button className="btn-primary" onClick={() => router.push("/purchasing/invoices/new")}>
          <L k="new" />
        </button>
      }
      totals={{
        total_amount: fmtMoney(sumD(rows.map((r) => r.total_amount))),
      }}
      columns={[
        textCol("doc_no", "doc_no", (r) => r.doc_no ?? "(draft)", 110),
        dateCol("invoice_date", "date", (r) => r.invoice_date),
        textCol("supplier", "supplier", (r) => r.suppliers?.name, 180),
        textCol("supplier_inv", "supplier_invoice_no", (r) => r.invoice_number_supplier, 120),
        textCol("bol", "bill_of_lading", (r) => r.bill_of_lading, 110),
        textCol("bank", "bank_name", (r) => r.bank_name, 100),
        textCol("currency", "currency", (r) => r.currency, 70),
        moneyCol("advance_payment", "advance_payment", (r) => r.advance_payment),
        moneyCol("bank_balance_due", "bank_balance_due", (r) => r.bank_balance_due),
        moneyCol("total_amount", "total_amount", (r) => r.total_amount),
        statusCol((r) => r.status),
      ]}
    />
  );
}
