/** CSV export — values are exported exactly as displayed (no float math). */
export function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const esc = (v: string) => {
    if (/[",\n،]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  };
  const bom = "﻿"; // Excel-friendly UTF-8 for Pashto text
  const body = [headers, ...rows].map((r) => r.map((c) => esc(c ?? "")).join(",")).join("\r\n");
  const blob = new Blob([bom + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
