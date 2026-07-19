"use client";

import Link from "next/link";
import { L } from "@/components/L";
import type { LabelKey } from "@/lib/labels";

const REPORTS: Array<{ k: LabelKey; href: string }> = [
  { k: "report_supplier_statement", href: "/reports/supplier-statement" },
  { k: "report_warehouse_statement", href: "/reports/warehouse-statement" },
  { k: "report_warehouse_stock", href: "/reports/warehouse-stock" },
  { k: "report_order_status", href: "/reports/order-status" },
  { k: "report_landed_cost", href: "/reports/landed-cost" },
  { k: "report_saraf_statement", href: "/reports/saraf-statement" },
  { k: "report_roznamcha_daily", href: "/roznamcha" },
  { k: "report_monthly_cash", href: "/reports/monthly-cash" },
  { k: "report_sales_summary", href: "/reports/sales-summary" },
  { k: "report_expense_by_category", href: "/reports/expenses-by-category" },
  { k: "report_receivables_aging", href: "/reports/receivables-aging" },
  { k: "report_order_profit", href: "/reports/order-profit" },
];

export default function ReportsHub() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      {REPORTS.map((r) => (
        <Link key={r.href} href={r.href} className="panel px-3 py-2.5 hover:border-accent">
          <L k={r.k} />
        </Link>
      ))}
    </div>
  );
}
