"use client";

/** Minimal chrome for print routes: white page, a no-print toolbar only. */
import { L } from "@/components/L";

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white min-h-screen text-black">
      <div className="no-print p-2 border-b border-line flex gap-2">
        <button className="btn-primary" onClick={() => window.print()}>
          <L k="print" />
        </button>
        <button className="btn-secondary" onClick={() => window.close()}>
          <L k="close" />
        </button>
      </div>
      <div className="max-w-[190mm] mx-auto p-6 print:p-0">{children}</div>
    </div>
  );
}
