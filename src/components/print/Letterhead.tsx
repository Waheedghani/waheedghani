/** Business letterhead block for printed documents: bilingual, B/W. */
import { labels, type LabelKey } from "@/lib/labels";
import { fmtDate } from "@/lib/dates";

export function Letterhead({ titleKey, date, docNo }: { titleKey: LabelKey; date?: string; docNo?: string }) {
  const t = labels[titleKey];
  return (
    <header className="border-b-2 border-black pb-2 mb-4">
      <div className="flex items-baseline justify-between">
        <div className="text-xl font-bold">{labels.app_name.en}</div>
        <div dir="rtl" lang="ps" className="font-pashto text-xl font-bold">
          {labels.app_name.ps}
        </div>
      </div>
      <div className="flex items-baseline justify-between mt-1">
        <div className="font-semibold">{t.en}</div>
        <div dir="rtl" lang="ps" className="font-pashto font-semibold">{t.ps}</div>
      </div>
      <div className="flex items-baseline justify-between text-sm mt-1">
        <span>
          {labels.date.en} / <span dir="rtl" lang="ps" className="font-pashto">{labels.date.ps}</span>:{" "}
          <span className="num">{date ? fmtDate(date) : ""}</span>
        </span>
        {docNo && (
          <span>
            {labels.doc_no.en} / <span dir="rtl" lang="ps" className="font-pashto">{labels.doc_no.ps}</span>:{" "}
            <span className="font-mono">{docNo}</span>
          </span>
        )}
      </div>
    </header>
  );
}

export function SignatureBlocks() {
  return (
    <footer className="mt-10 grid grid-cols-3 gap-8 text-sm">
      {(["prepared_by", "approved_by", "signature"] as LabelKey[]).map((k) => (
        <div key={k} className="text-center">
          <div className="border-t border-black pt-1">
            {labels[k].en} /{" "}
            <span dir="rtl" lang="ps" className="font-pashto">{labels[k].ps}</span>
          </div>
        </div>
      ))}
    </footer>
  );
}
