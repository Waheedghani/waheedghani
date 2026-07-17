import { labels, type LabelKey } from "@/lib/labels";

/**
 * Bilingual label: English first, Pashto after a separator, correct RTL.
 * The standard rendering pattern for every label in the app (spec §9).
 */
export function L({ k, sep = "/" }: { k: LabelKey; sep?: string }) {
  const l = labels[k];
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span>{l.en}</span>
      <span aria-hidden className="text-ink-faint">
        {sep}
      </span>
      <span dir="rtl" lang="ps" className="font-pashto text-[1.07em] leading-none">
        {l.ps}
      </span>
    </span>
  );
}

/** Pashto-only span with correct direction/font (for report headers etc.). */
export function Ps({ k }: { k: LabelKey }) {
  return (
    <span dir="rtl" lang="ps" className="font-pashto text-[1.07em]">
      {labels[k].ps}
    </span>
  );
}
