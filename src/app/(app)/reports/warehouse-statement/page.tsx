"use client";

/** The weekly سرای statement — this is what gets handed to the keeper. */
import { useState } from "react";
import { LedgerStatement } from "@/components/LedgerStatement";
import { Field, Select } from "@/components/ui/fields";
import { L } from "@/components/L";
import { useWarehouses } from "@/lib/lookups";

export default function WarehouseStatementReport() {
  const warehouses = useWarehouses();
  const [whId, setWhId] = useState("");
  const wh = (warehouses.data ?? []).find((w) => w.id === whId);

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-end gap-3 no-print">
        <span className="font-semibold text-lg"><L k="report_warehouse_statement" /></span>
        <Field k="warehouse">
          <Select value={whId} onChange={(e) => setWhId(e.target.value)}>
            <option value="" />
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.name} / {w.name_ps}</option>
            ))}
          </Select>
        </Field>
        {wh && (
          <button className="btn-secondary"
            onClick={() => window.open(`/print/warehouse-statement/${wh.id}`, "_blank")}>
            <L k="print" />
          </button>
        )}
      </div>
      {wh && (
        <div className="panel p-3">
          <LedgerStatement accountId={wh.account_id} exportName={`warehouse-${wh.name}`} />
        </div>
      )}
    </div>
  );
}
