"use client";

/**
 * Compact labeled form fields (label above input, 4–6 per row on desktop).
 * All bilingual via <L/>; free-text inputs use dir="auto" for Pashto.
 */
import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { L } from "@/components/L";
import type { LabelKey } from "@/lib/labels";
import { CURRENCIES } from "@/lib/money";

export function FieldGrid({ children, cols = 4 }: { children: React.ReactNode; cols?: number }) {
  const cls =
    cols === 6
      ? "grid gap-2 grid-cols-2 md:grid-cols-6"
      : cols === 3
        ? "grid gap-2 grid-cols-1 md:grid-cols-3"
        : cols === 2
          ? "grid gap-2 grid-cols-1 md:grid-cols-2"
          : "grid gap-2 grid-cols-2 md:grid-cols-4";
  return <div className={cls}>{children}</div>;
}

interface FieldProps {
  k: LabelKey;
  error?: string;
  span?: number;
  children: React.ReactNode;
}

export function Field({ k, error, span, children }: FieldProps) {
  return (
    <div className={`field ${span === 2 ? "col-span-2" : span === 4 ? "col-span-2 md:col-span-4" : ""}`}>
      <span className="field-label">
        <L k={k} />
      </span>
      {children}
      {error && <span className="text-xs text-status-reversed">{error}</span>}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput(props, ref) {
    return <input ref={ref} dir="auto" {...props} className={`input ${props.className ?? ""}`} />;
  }
);

/** Numeric input: text-based so decimal.js parses it — never a JS number. */
export const AmountInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function AmountInput(props, ref) {
    return (
      <input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        {...props}
        className={`input num ${props.className ?? ""}`}
      />
    );
  }
);

export const DateInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function DateInput(props, ref) {
    return <input ref={ref} type="date" {...props} className={`input ${props.className ?? ""}`} />;
  }
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select(props, ref) {
    return <select ref={ref} {...props} className={`input ${props.className ?? ""}`} />;
  }
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea(props, ref) {
    return <textarea ref={ref} dir="auto" rows={2} {...props} className={`input ${props.className ?? ""}`} />;
  }
);

export const CurrencySelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function CurrencySelect(props, ref) {
    return (
      <Select ref={ref} {...props}>
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
    );
  }
);
