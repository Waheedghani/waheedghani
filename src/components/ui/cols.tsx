"use client";

/** Column builders with bilingual headers, ERP-formatted cells. */
import type { ColumnDef } from "@tanstack/react-table";
import { L } from "@/components/L";
import { StatusChip } from "@/components/StatusChip";
import type { LabelKey } from "@/lib/labels";
import { lblEn } from "@/lib/labels";
import { fmtDate } from "@/lib/dates";
import { fmtMoney, fmtQty, type Currency } from "@/lib/money";

type Getter<T> = (row: T) => string | number | null | undefined;

export function textCol<T>(id: string, key: LabelKey, get: Getter<T>, size = 140): ColumnDef<T, unknown> {
  return {
    id,
    header: () => <L k={key} />,
    accessorFn: (r) => get(r) ?? "",
    cell: (c) => (
      <span dir="auto" className="block truncate">
        {String(c.getValue() ?? "")}
      </span>
    ),
    size,
    meta: { csvHeader: lblEn(key) },
  };
}

export function dateCol<T>(id: string, key: LabelKey, get: Getter<T>, size = 90): ColumnDef<T, unknown> {
  return {
    id,
    header: () => <L k={key} />,
    accessorFn: (r) => get(r) ?? "",
    cell: (c) => <span className="num block">{fmtDate(String(c.getValue() ?? ""))}</span>,
    size,
    meta: { csvHeader: lblEn(key) },
  };
}

export function moneyCol<T>(
  id: string,
  key: LabelKey,
  get: Getter<T>,
  currency?: (row: T) => Currency,
  size = 110
): ColumnDef<T, unknown> {
  return {
    id,
    header: () => (
      <span className="block text-right">
        <L k={key} />
      </span>
    ),
    accessorFn: (r) => get(r) ?? "",
    cell: (c) => (
      <span className="num block">
        {fmtMoney(c.getValue() as string, currency ? currency(c.row.original) : undefined)}
      </span>
    ),
    size,
    enableColumnFilter: false,
    meta: { csvHeader: lblEn(key) },
  };
}

export function qtyCol<T>(id: string, key: LabelKey, get: Getter<T>, size = 90): ColumnDef<T, unknown> {
  return {
    id,
    header: () => (
      <span className="block text-right">
        <L k={key} />
      </span>
    ),
    accessorFn: (r) => get(r) ?? "",
    cell: (c) => <span className="num block">{fmtQty(c.getValue() as string)}</span>,
    size,
    enableColumnFilter: false,
    meta: { csvHeader: lblEn(key) },
  };
}

export function statusCol<T>(get: Getter<T>, size = 110): ColumnDef<T, unknown> {
  return {
    id: "status",
    header: () => <L k="status" />,
    accessorFn: (r) => get(r) ?? "",
    cell: (c) => <StatusChip status={String(c.getValue() ?? "")} />,
    size,
    meta: { csvHeader: lblEn("status") },
  };
}
