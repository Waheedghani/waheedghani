/**
 * Money math (client side, DISPLAY ONLY).
 * All authoritative financial computation happens in Postgres. The browser
 * uses decimal.js purely to echo line totals while the user types and to
 * format server-computed NUMERIC strings. Never native float arithmetic.
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Currency = "AFN" | "USD";

export const CURRENCIES: Currency[] = ["AFN", "USD"];

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  AFN: "؋",
  USD: "$",
};

/** Safe Decimal constructor: accepts numeric strings from Postgres, numbers, null. */
export function D(v: string | number | Decimal | null | undefined): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  return new Decimal(v);
}

/** Sum a column of NUMERIC strings exactly. */
export function sumD(values: Array<string | number | null | undefined>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Decimal(0));
}

/**
 * Format money for display: LTR, Western digits, thousands separators,
 * 2 decimal places (values are stored NUMERIC(18,4); display rounding
 * happens ONLY here, at render time).
 */
export function fmtMoney(
  v: string | number | Decimal | null | undefined,
  currency?: Currency,
  opts?: { dp?: number; blankZero?: boolean }
): string {
  const dp = opts?.dp ?? 2;
  const d = D(v);
  if (opts?.blankZero && d.isZero()) return "";
  const fixed = d.toFixed(dp);
  const [intPart = "0", frac] = fixed.split(".");
  const neg = intPart.startsWith("-");
  const digits = neg ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = `${neg ? "-" : ""}${grouped}${frac !== undefined ? "." + frac : ""}`;
  return currency ? `${CURRENCY_SYMBOL[currency]} ${body}` : body;
}

/** Format a quantity NUMERIC(14,3): trims trailing zeros, keeps up to 3 dp. */
export function fmtQty(v: string | number | Decimal | null | undefined): string {
  const d = D(v);
  const s = d.toFixed(3).replace(/\.?0+$/, "");
  const [intPart = "0", frac] = s.split(".");
  const neg = intPart.startsWith("-");
  const digits = neg ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}${frac ? "." + frac : ""}`;
}

/** Format an FX rate NUMERIC(12,6) without trailing zero noise (min 2 dp). */
export function fmtRate(v: string | number | Decimal | null | undefined): string {
  const d = D(v);
  if (d.isZero()) return "";
  const s = d.toFixed(6).replace(/0+$/, "");
  return s.endsWith(".") ? s + "00" : s.split(".")[1]!.length < 2 ? d.toFixed(2) : s;
}

/** Serialize a Decimal for a NUMERIC(18,4) column. */
export function toMoneyString(v: Decimal | string | number): string {
  return D(v).toFixed(4);
}

/** Serialize a Decimal for a NUMERIC(14,3) quantity column. */
export function toQtyString(v: Decimal | string | number): string {
  return D(v).toFixed(3);
}

/** Parse user keyboard input; returns null when not a valid number. */
export function parseAmount(input: string): Decimal | null {
  const cleaned = input.replace(/[,\s]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  try {
    return new Decimal(cleaned);
  } catch {
    return null;
  }
}

export { Decimal };
