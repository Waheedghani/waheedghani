/**
 * Date display — the single funnel for every date shown in the UI.
 * Storage is timestamptz (UTC) / date; display is Asia/Kabul, Gregorian.
 * When the client wants Solar Hijri later, it is added HERE only.
 */

export const KABUL_TZ = "Asia/Kabul";

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: KABUL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: KABUL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** A plain DATE column ("2026-07-16") — render as-is, it has no timezone. */
export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  return dateFmt.format(typeof value === "string" ? new Date(value) : value);
}

/** A timestamptz — convert to Kabul time. */
export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  return dateTimeFmt.format(typeof value === "string" ? new Date(value) : value);
}

/** Today's date in Kabul as YYYY-MM-DD (for date-input defaults). */
export function todayKabul(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KABUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // en-CA gives YYYY-MM-DD
}

/** First day of the current month in Kabul (default range start for reports). */
export function monthStartKabul(): string {
  return todayKabul().slice(0, 8) + "01";
}
