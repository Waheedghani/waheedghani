import { L } from "@/components/L";
import type { LabelKey } from "@/lib/labels";

const STYLES: Record<string, string> = {
  draft: "border-line-strong text-status-draft bg-surface-sunken",
  posted: "border-status-posted text-status-posted bg-status-postedBg",
  received: "border-status-posted text-status-posted bg-status-postedBg",
  open: "border-line-strong text-ink-soft bg-white",
  partially_received: "border-status-partial text-status-partial bg-status-partialBg",
  reversed: "border-status-reversed text-status-reversed bg-status-reversedBg",
  closed: "border-status-closed text-status-closed bg-status-closedBg",
  resolved: "border-status-posted text-status-posted bg-status-postedBg",
  ok: "border-status-posted text-status-posted bg-status-postedBg",
  warning: "border-status-partial text-status-partial bg-status-partialBg",
  critical: "border-status-reversed text-status-reversed bg-status-reversedBg",
};

const KEY: Record<string, LabelKey> = {
  draft: "draft",
  posted: "posted",
  received: "received",
  open: "open",
  partially_received: "partially_received",
  reversed: "reversed",
  closed: "closed",
  resolved: "resolved",
  ok: "ok",
  warning: "warning",
  critical: "critical",
};

/** Small squared status chip (spec §10.5). */
export function StatusChip({ status }: { status: string }) {
  const style = STYLES[status] ?? STYLES.draft;
  const key = KEY[status];
  return (
    <span className={`chip ${style}`}>{key ? <L k={key} /> : status}</span>
  );
}
