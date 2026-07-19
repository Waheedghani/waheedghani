"use client";

import { useState } from "react";
import { LedgerStatement } from "@/components/LedgerStatement";
import { Field, Select } from "@/components/ui/fields";
import { L } from "@/components/L";
import { useSarafs } from "@/lib/lookups";

export default function SarafStatementReport() {
  const sarafs = useSarafs();
  const [sarafId, setSarafId] = useState("");
  const saraf = (sarafs.data ?? []).find((s) => s.id === sarafId);

  return (
    <div className="space-y-2">
      <div className="panel px-3 py-2 flex items-end gap-3 no-print">
        <span className="font-semibold text-lg"><L k="report_saraf_statement" /></span>
        <Field k="saraf">
          <Select value={sarafId} onChange={(e) => setSarafId(e.target.value)}>
            <option value="" />
            {(sarafs.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
      </div>
      {saraf && (
        <div className="panel p-3">
          <LedgerStatement accountId={saraf.account_id} exportName={`saraf-${saraf.name}`} />
        </div>
      )}
    </div>
  );
}
