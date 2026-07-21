import { labels, type LabelKey } from "@/lib/labels";

/**
 * Bilingual label: English first, Pashto after a separator, correct RTL.
 * Renders as inline text so long labels wrap within their container instead
 * of overflowing (short labels in buttons/table headers still sit on one
 * line because they fit). Each language span carries its own dir/lang so the
 * bidi isolation is correct.
 */
export function L({ k, sep = "/" }: { k: LabelKey; sep?: string }) {
  const l = labels[k];
  return (
    <span>
      <span>{l.en}</span>
      <span aria-hidden className="text-ink-faint mx-1">
        {sep}
      </span>
      <span dir="rtl" lang="ps" className="font-pashto text-[1.07em]">
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
