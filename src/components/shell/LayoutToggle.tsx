"use client";

import { useUiPrefs } from "@/components/UiPrefs";
import { labels } from "@/lib/labels";

/**
 * Small segmented Classic/Modern switch. `tone` picks colors for a light
 * (classic header, on navy) or dark (modern sidebar footer) surface.
 */
export function LayoutToggle({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const { layout, setLayout } = useUiPrefs();
  const base =
    "px-2 h-6 text-[11px] rounded-[3px] transition-colors";
  const container =
    tone === "dark"
      ? "inline-flex items-center gap-0.5 p-0.5 rounded-[4px] bg-black/25"
      : "inline-flex items-center gap-0.5 p-0.5 rounded-[4px] bg-white/15";
  const active = "bg-accent text-white";
  const idle = tone === "dark" ? "text-white/70 hover:text-white" : "text-white/80 hover:text-white";

  return (
    <div className={container} role="group" aria-label={labels.interface.en}>
      <button
        className={`${base} ${layout === "modern" ? active : idle}`}
        onClick={() => setLayout("modern")}
        title={labels.modern_view.en + " / " + labels.modern_view.ps}
      >
        {labels.modern_view.en}
      </button>
      <button
        className={`${base} ${layout === "classic" ? active : idle}`}
        onClick={() => setLayout("classic")}
        title={labels.classic_view.en + " / " + labels.classic_view.ps}
      >
        {labels.classic_view.en}
      </button>
    </div>
  );
}
