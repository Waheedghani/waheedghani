import type { LabelKey } from "@/lib/labels";
import type { AppRole } from "@/lib/types";

export interface NavItem {
  key: LabelKey;
  href: string;
}

export interface NavModule {
  key: LabelKey;
  href: string;
  roles: AppRole[];
  items: NavItem[];
}

/**
 * Top module bar (spec §10.1). Warehouse users get only their own portal —
 * enforced again by Postgres RLS regardless of what the client renders.
 */
export const NAV: NavModule[] = [
  { key: "home", href: "/", roles: ["admin", "office"], items: [] },
  {
    key: "purchasing",
    href: "/purchasing/invoices",
    roles: ["admin", "office"],
    items: [
      { key: "purchase_invoices", href: "/purchasing/invoices" },
      { key: "suppliers", href: "/purchasing/suppliers" },
      { key: "supplier_payments", href: "/purchasing/payments" },
    ],
  },
  {
    key: "orders",
    href: "/orders",
    roles: ["admin", "office"],
    items: [{ key: "order_book", href: "/orders" }],
  },
  {
    key: "inventory",
    href: "/inventory",
    roles: ["admin", "office"],
    items: [{ key: "stock_overview", href: "/inventory" }],
  },
  {
    key: "warehouses",
    href: "/warehouses",
    roles: ["admin", "office"],
    items: [
      { key: "warehouses", href: "/warehouses" },
      { key: "dispatch_invoices", href: "/warehouses/dispatches" },
      { key: "warehouse_payments", href: "/warehouses/payments" },
    ],
  },
  {
    key: "sarafs",
    href: "/sarafs",
    roles: ["admin", "office"],
    items: [
      { key: "sarafs", href: "/sarafs" },
      { key: "saraf_transactions", href: "/sarafs/transactions" },
    ],
  },
  { key: "roznamcha", href: "/roznamcha", roles: ["admin", "office"], items: [] },
  {
    key: "expenses",
    href: "/expenses",
    roles: ["admin", "office"],
    items: [
      { key: "office_expenses", href: "/expenses" },
      { key: "expense_categories", href: "/expenses/categories" },
    ],
  },
  { key: "reports", href: "/reports", roles: ["admin", "office"], items: [] },
  {
    key: "administration",
    href: "/admin/users",
    roles: ["admin"],
    items: [
      { key: "users", href: "/admin/users" },
      { key: "audit_log", href: "/admin/audit" },
      { key: "data_health", href: "/admin/health" },
      { key: "reconciliation", href: "/admin/reconciliation" },
    ],
  },
  // Warehouse keeper portal
  {
    key: "my_warehouse",
    href: "/portal",
    roles: ["warehouse"],
    items: [
      { key: "overview", href: "/portal" },
      { key: "stock_ledger", href: "/portal/stock" },
      { key: "money_ledger", href: "/portal/money" },
      { key: "dispatch_invoices", href: "/portal/dispatches" },
      { key: "buyer_pickups", href: "/portal/pickups" },
    ],
  },
];

export function navForRole(role: AppRole): NavModule[] {
  return NAV.filter((m) => m.roles.includes(role));
}
