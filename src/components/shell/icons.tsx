/**
 * Inline SVG module icons (stroke, currentColor). No external icon library —
 * keeps the bundle lean and avoids any network dependency.
 */
import type { LabelKey } from "@/lib/labels";

const PATHS: Record<string, string> = {
  home: "M3 10.5 12 4l9 6.5M5 9.5V20h5v-6h4v6h5V9.5",
  purchasing: "M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2",
  orders: "M8 4h8v3H8zM7 6h10v14H7zM10 11h4M10 15h4",
  inventory: "M12 3 21 7.5v9L12 21 3 16.5v-9L12 3Zm-9 4.5L12 12l9-4.5M12 12v9",
  warehouses: "M3 21V9l9-5 9 5v12M9 21v-6h6v6",
  sarafs: "M4 8h16v9H4zM4 12h16M8 15h2",
  roznamcha: "M5 4h13v16H7a2 2 0 0 1-2-2V4Zm3 0v16M10 8h5M10 12h5",
  expenses: "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6",
  reports: "M3 21h18M7 21v-6M12 21V8M17 21v-10",
  administration: "M4 7h9M17 7h3M4 12h3M11 12h9M4 17h6M14 17h6M13 5v4M7 10v4M10 15v4",
  my_warehouse: "M3 21V9l9-5 9 5v12M9 21v-6h6v6",
  overview: "M4 13h6V4H4zM14 20h6V4h-6zM4 20h6v-5H4z",
  stock_ledger: "M12 3 21 7.5v9L12 21 3 16.5v-9L12 3Zm-9 4.5L12 12l9-4.5M12 12v9",
  money_ledger: "M4 8h16v9H4zM4 12h16M8 15h2",
  dispatch_invoices: "M8 4h8v3H8zM7 6h10v14H7zM10 11h4M10 15h4",
  buyer_pickups: "M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2",
};

const DEFAULT = "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z";

export function ModuleIcon({ k, className }: { k: LabelKey | string; className?: string }) {
  const d = PATHS[k] ?? DEFAULT;
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
