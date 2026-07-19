"use client";

/**
 * Dense ERP list table (spec §10.3): TanStack Table with column sort,
 * per-column filter row, resizable columns, sticky header, pinned totals row,
 * CSV export, row count + pagination, double-click to open.
 */
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type Row,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useState, type ReactNode } from "react";
import { L } from "@/components/L";
import { lbl, lblEn } from "@/lib/labels";
import { downloadCsv } from "@/lib/csv";

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  onRowOpen?: (row: T) => void;
  /** cells for the pinned totals row, keyed by column id */
  totals?: Record<string, ReactNode>;
  exportName?: string;
  loading?: boolean;
  toolbar?: ReactNode;
  pageSize?: number;
}

export function DataTable<T>({
  columns,
  data,
  onRowOpen,
  totals,
  exportName,
  loading,
  toolbar,
  pageSize = 50,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    columnResizeMode: "onChange",
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;
  const first = filteredCount === 0 ? 0 : pageIndex * pageSize + 1;
  const last = Math.min((pageIndex + 1) * pageSize, filteredCount);

  function exportCsv() {
    const leafCols = table.getVisibleLeafColumns();
    const headers = leafCols.map((c) => {
      const h = c.columnDef.meta as { csvHeader?: string } | undefined;
      return h?.csvHeader ?? c.id;
    });
    const body = table.getFilteredRowModel().rows.map((r) =>
      leafCols.map((c) => {
        const v = r.getValue(c.id);
        return v === null || v === undefined ? "" : String(v);
      })
    );
    downloadCsv(`${exportName ?? "export"}.csv`, headers, body);
  }

  return (
    <div className="panel flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-line-soft no-print">
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-secondary" onClick={exportCsv}>
            <L k="export_csv" />
          </button>
        </div>
      </div>

      <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 220px)" }}>
        <table className="erp-table" style={{ width: table.getCenterTotalSize() }}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    style={{ width: h.getSize() }}
                    className="relative select-none"
                  >
                    <button
                      className="flex items-center gap-1 w-full text-left font-semibold"
                      onClick={h.column.getToggleSortingHandler()}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === "asc" && <span>▲</span>}
                      {h.column.getIsSorted() === "desc" && <span>▼</span>}
                    </button>
                    <div
                      onMouseDown={h.getResizeHandler()}
                      onTouchStart={h.getResizeHandler()}
                      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-accent"
                    />
                  </th>
                ))}
              </tr>
            ))}
            {/* per-column filter row */}
            <tr className="no-print">
              {table.getHeaderGroups()[0]?.headers.map((h) => (
                <th key={h.id} className="!h-7 bg-white">
                  {h.column.getCanFilter() ? (
                    <input
                      className="input !h-5 w-full text-xs font-normal"
                      dir="auto"
                      placeholder={lbl("search")}
                      value={(h.column.getFilterValue() as string) ?? ""}
                      onChange={(e) => h.column.setFilterValue(e.target.value)}
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="text-center text-ink-faint py-6">
                  <L k="loading" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center text-ink-faint py-6">
                  <L k="no_data" />
                </td>
              </tr>
            ) : (
              rows.map((row: Row<T>) => (
                <tr
                  key={row.id}
                  onDoubleClick={() => onRowOpen?.(row.original)}
                  className={onRowOpen ? "cursor-pointer" : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} style={{ width: cell.column.getSize() }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {totals && rows.length > 0 && (
            <tfoot>
              <tr>
                {table.getVisibleLeafColumns().map((c, i) => (
                  <td key={c.id} className="num">
                    {i === 0 ? <L k="totals" /> : totals[c.id] ?? ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex items-center gap-2 px-2 py-1 border-t border-line-soft text-xs text-ink-soft no-print">
        <span>
          {first}–{last} {lblEn("of")} {filteredCount} {lblEn("rows")}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="btn-secondary !h-5 !px-1.5"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            ‹
          </button>
          <span>
            <L k="page" /> {pageIndex + 1}
          </span>
          <button
            className="btn-secondary !h-5 !px-1.5"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
