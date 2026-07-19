"use client";

/**
 * Record-screen pattern (spec §10.4): toolbar (New | Save | Post | Reverse |
 * Print | History, disabled per status/role), content, audit strip footer.
 * Keyboard: Ctrl+S save, Ctrl+P post (with permanent-posting confirm).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { L } from "@/components/L";
import { StatusChip } from "@/components/StatusChip";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { HistoryDrawer } from "@/components/ui/HistoryDrawer";
import { useAuth } from "@/components/AuthProvider";
import { fmtDateTime } from "@/lib/dates";

export interface DocumentShellProps {
  title: React.ReactNode;
  status?: string;
  docNo?: string | null;
  newHref?: string;
  canSave?: boolean;
  canPost?: boolean;
  canReverse?: boolean;
  printHref?: string;
  onSave?: () => void | Promise<unknown>;
  onPost?: () => void | Promise<unknown>;
  onReverse?: (reason: string) => void | Promise<unknown>;
  historyTable?: string;
  historyPk?: string;
  createdBy?: string | null;
  createdAt?: string | null;
  postedBy?: string | null;
  postedAt?: string | null;
  busy?: boolean;
  error?: string | null;
  children: React.ReactNode;
}

export function DocumentShell(p: DocumentShellProps) {
  const router = useRouter();
  const { profile } = useAuth();
  const [confirmPost, setConfirmPost] = useState(false);
  const [confirmReverse, setConfirmReverse] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key.toLowerCase() === "s" && p.canSave && p.onSave) {
        e.preventDefault();
        void p.onSave();
      }
      if (e.ctrlKey && e.key.toLowerCase() === "p" && p.canPost && p.onPost) {
        e.preventDefault();
        setConfirmPost(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.canSave, p.canPost]);

  return (
    <div className="space-y-2">
      <div className="panel px-2 py-1.5 flex items-center gap-1.5 no-print">
        <span className="font-semibold text-lg mr-2">{p.title}</span>
        {p.status && <StatusChip status={p.status} />}
        <span className="mx-2 text-line-strong">|</span>
        {p.newHref && (
          <button className="btn-secondary" onClick={() => router.push(p.newHref!)}>
            <L k="new" />
          </button>
        )}
        {p.onSave && (
          <button className="btn-secondary" disabled={!p.canSave || p.busy} onClick={() => void p.onSave!()}>
            <L k="save" />
          </button>
        )}
        {p.onPost && (
          <button
            className="btn-primary"
            disabled={!p.canPost || p.busy}
            onClick={() => setConfirmPost(true)}
          >
            <L k="post" />
          </button>
        )}
        {p.onReverse && (
          <button
            className="btn-danger"
            disabled={!p.canReverse || !isAdmin || p.busy}
            onClick={() => setConfirmReverse(true)}
          >
            <L k="reverse" />
          </button>
        )}
        {p.printHref && (
          <button className="btn-secondary" onClick={() => window.open(p.printHref, "_blank")}>
            <L k="print" />
          </button>
        )}
        {p.historyTable && p.historyPk && isAdmin && (
          <button className="btn-secondary" onClick={() => setShowHistory(true)}>
            <L k="history" />
          </button>
        )}
        {p.error && <span className="text-status-reversed text-xs ml-3" dir="auto">{p.error}</span>}
      </div>

      {p.children}

      <div className="text-xs text-ink-faint px-1 flex flex-wrap gap-x-4 no-print">
        {p.createdBy && (
          <span>
            <L k="created_by" /> {p.createdBy} • {fmtDateTime(p.createdAt)}
          </span>
        )}
        {p.postedBy && (
          <span>
            <L k="posted_by" /> {p.postedBy} • {fmtDateTime(p.postedAt)}
          </span>
        )}
        {p.docNo && (
          <span>
            <L k="doc_no" /> {p.docNo}
          </span>
        )}
        {p.status && (
          <span>
            <L k="status" /> <StatusChip status={p.status} />
          </span>
        )}
      </div>

      <ConfirmDialog
        open={confirmPost}
        titleKey="confirm_post_title"
        bodyKey="posting_permanent"
        onConfirm={() => {
          setConfirmPost(false);
          void p.onPost?.();
        }}
        onCancel={() => setConfirmPost(false)}
      />
      <ConfirmDialog
        open={confirmReverse}
        titleKey="confirm_reverse_title"
        bodyKey="posting_permanent"
        promptKey="reverse_reason_prompt"
        danger
        onConfirm={(reason) => {
          setConfirmReverse(false);
          void p.onReverse?.(reason);
        }}
        onCancel={() => setConfirmReverse(false)}
      />
      {showHistory && p.historyTable && p.historyPk && (
        <HistoryDrawer table={p.historyTable} pk={p.historyPk} onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}
