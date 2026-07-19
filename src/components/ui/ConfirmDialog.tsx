"use client";

import { useEffect, useRef, useState } from "react";
import { L } from "@/components/L";
import type { LabelKey } from "@/lib/labels";

interface ConfirmDialogProps {
  open: boolean;
  titleKey: LabelKey;
  bodyKey?: LabelKey;
  /** when set, a required text input is shown (e.g. reversal reason) */
  promptKey?: LabelKey;
  onConfirm: (promptValue: string) => void;
  onCancel: () => void;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  titleKey,
  bodyKey,
  promptKey,
  onConfirm,
  onCancel,
  danger,
}: ConfirmDialogProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const confirmDisabled = !!promptKey && value.trim().length === 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center no-print">
      <div className="panel w-[420px] p-4 space-y-3 shadow-xl">
        <div className="font-semibold">
          <L k={titleKey} />
        </div>
        {bodyKey && (
          <div className="text-ink-soft text-sm">
            <L k={bodyKey} />
          </div>
        )}
        {promptKey && (
          <label className="field">
            <span className="field-label">
              <L k={promptKey} />
            </span>
            <input
              ref={inputRef}
              dir="auto"
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !confirmDisabled) onConfirm(value.trim());
              }}
            />
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={onCancel}>
            <L k="cancel" />
          </button>
          <button
            className={danger ? "btn-danger" : "btn-primary"}
            disabled={confirmDisabled}
            onClick={() => onConfirm(value.trim())}
          >
            <L k="confirm" />
          </button>
        </div>
      </div>
    </div>
  );
}
