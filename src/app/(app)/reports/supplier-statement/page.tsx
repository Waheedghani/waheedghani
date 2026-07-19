"use client";

import { useState } from "react";
import { LedgerStatement } from "@/components/LedgerStatement";
import { Field, Select } from "@/components/ui/fields";
import { L } from "@/components/L";
import { useSuppliers } from "@/lib/lookups";

export default function SupplierStatementReport() {
  const suppliers = useSuppliers();
  const [supplierId, setSupplierId] = useState("");
  const supplier = (suppliers.data ?? []).find((s) => s.id === supplierId);

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-end gap-3 no-print">
        <span className="font-semibold text-lg"><L k="report_supplier_statement" /></span>
        <Field k="supplier">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="" />
            {(suppliers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
      </div>
      {supplier && (
        <div className="panel p-3">
          <LedgerStatement accountId={supplier.account_id} defaultCurrency="USD"
            exportName={`supplier-${supplier.name}`} />
        </div>
      )}
    </div>
  );
}
