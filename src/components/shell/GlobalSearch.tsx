"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { lbl } from "@/lib/labels";
import { useAuth } from "@/components/AuthProvider";

interface Hit {
  kind: string;
  label: string;
  sub: string;
  href: string;
}

/** Global search: documents by number, parties by name (spec §10.1). */
export function GlobalSearch() {
  const router = useRouter();
  const { profile } = useAuth();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q || q.trim().length < 2 || profile?.role === "warehouse") {
      setHits([]);
      return;
    }
    timer.current = setTimeout(() => void runSearch(q.trim()), 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function runSearch(term: string) {
    const sb = supabase();
    const like = `%${term}%`;
    const results: Hit[] = [];

    const [sup, wh, srf, pi, dsp, ord, pay, exp] = await Promise.all([
      sb.from("suppliers").select("id,name,name_ps").ilike("name", like).limit(5),
      sb.from("warehouses").select("id,name,name_ps").ilike("name", like).limit(5),
      sb.from("sarafs").select("id,name,name_ps").ilike("name", like).limit(5),
      sb.from("purchase_invoices").select("id,doc_no,status").ilike("doc_no", like).limit(5),
      sb.from("dispatch_invoices").select("id,doc_no,status").ilike("doc_no", like).limit(5),
      sb.from("orders").select("id,doc_no,status").ilike("doc_no", like).limit(5),
      sb.from("warehouse_payments").select("id,doc_no,status").ilike("doc_no", like).limit(5),
      sb.from("office_expenses").select("id,doc_no,status").ilike("doc_no", like).limit(5),
    ]);

    for (const s of sup.data ?? []) results.push({ kind: "Supplier", label: s.name, sub: s.name_ps, href: `/purchasing/suppliers?id=${s.id}` });
    for (const s of wh.data ?? []) results.push({ kind: "Warehouse", label: s.name, sub: s.name_ps, href: `/warehouses/${s.id}` });
    for (const s of srf.data ?? []) results.push({ kind: "Saraf", label: s.name, sub: s.name_ps, href: `/sarafs?id=${s.id}` });
    for (const d of pi.data ?? []) results.push({ kind: "Purchase Invoice", label: d.doc_no ?? `(${lbl("draft")})`, sub: d.status, href: `/purchasing/invoices/${d.id}` });
    for (const d of dsp.data ?? []) results.push({ kind: "Dispatch", label: d.doc_no ?? `(${lbl("draft")})`, sub: d.status, href: `/warehouses/dispatches/${d.id}` });
    for (const d of ord.data ?? []) results.push({ kind: "Order", label: d.doc_no, sub: d.status, href: `/orders/${d.id}` });
    for (const d of pay.data ?? []) results.push({ kind: "Warehouse Payment", label: d.doc_no ?? `(${lbl("draft")})`, sub: d.status, href: `/warehouses/payments/${d.id}` });
    for (const d of exp.data ?? []) results.push({ kind: "Expense", label: d.doc_no ?? `(${lbl("draft")})`, sub: d.status, href: `/expenses/${d.id}` });

    setHits(results.slice(0, 12));
    setOpen(true);
  }

  return (
    <div ref={boxRef} className="relative w-72">
      <input
        className="input w-full"
        placeholder={lbl("search")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
      />
      {open && hits.length > 0 && (
        <ul className="absolute z-50 top-full mt-0.5 w-full bg-white border border-line shadow-lg max-h-80 overflow-auto">
          {hits.map((h, i) => (
            <li key={i}>
              <button
                className="w-full text-left px-2 py-1.5 hover:bg-accent-soft flex items-baseline gap-2"
                onClick={() => {
                  setOpen(false);
                  setQ("");
                  router.push(h.href);
                }}
              >
                <span className="text-xs text-ink-faint w-28 shrink-0">{h.kind}</span>
                <span className="font-medium">{h.label}</span>
                <span dir="auto" className="text-ink-soft text-xs truncate">{h.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
