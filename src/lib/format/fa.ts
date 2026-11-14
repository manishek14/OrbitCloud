// Persian formatting helpers (client-safe).

const faDigits = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toFaDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => faDigits[Number(d)]);
}

export function toEnDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (d) => {
    const i = "۰۱۲۳۴۵۶۷۸۹".indexOf(d);
    if (i >= 0) return String(i);
    const j = "٠١٢٣٤٥٦٧٨٩".indexOf(d);
    return j >= 0 ? String(j) : d;
  });
}

/** Human-readable byte size with Persian digits, e.g. «۲٫۵ گیگابایت». */
export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  let text: string;
  if (abs >= 1024 ** 4) text = `${(value / 1024 ** 4).toFixed(1)} ترابایت`;
  else if (abs >= 1024 ** 3) text = `${(value / 1024 ** 3).toFixed(1)} گیگابایت`;
  else if (abs >= 1024 ** 2) text = `${(value / 1024 ** 2).toFixed(1)} مگابایت`;
  else if (abs >= 1024) text = `${(value / 1024).toFixed(1)} کیلوبایت`;
  else text = `${Math.round(value)} بایت`;
  return toFaDigits(text.replace(/\.0(?=\s)/, ""));
}

export function formatToman(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return toFaDigits(value.toLocaleString("en-US"));
}

export function formatPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return "—";
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  return toFaDigits(String(pct));
}

const dateFmt = new Intl.DateTimeFormat("fa-IR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return dateFmt.format(d);
  } catch {
    return "—";
  }
}

/** Short relative time in Persian, e.g. «۳ دقیقه پیش». */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const seconds = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return toFaDigits(String(seconds)) + " ثانیه پیش";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return toFaDigits(String(minutes)) + " دقیقه پیش";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return toFaDigits(String(hours)) + " ساعت پیش";
  const days = Math.floor(hours / 24);
  if (days < 30) return toFaDigits(String(days)) + " روز پیش";
  return formatDateTime(iso);
}
