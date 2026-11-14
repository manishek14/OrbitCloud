// ============================================================================
// Login identifier parsing & mobile normalization — SINGLE source of truth.
//
// Pure module (no server imports) so the exact same rules run on the client
// (login view) and the server (API routes). Every code path that previously
// re-implemented digit normalization (otp.ts, recover/reset, validation.ts)
// delegates here, eliminating divergent phone formats:
// the canonical stored/looked-up mobile form is ALWAYS `09XXXXXXXXX`.
// ============================================================================

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export const MOBILE_PATTERN = /^09\d{9}$/;

/** Persian/Arabic digits → EN, strips spaces/hyphens/tabs. Never throws. */
export function normalizeIdentifierDigits(input: string): string {
  return String(input ?? "")
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[\s\u200c\u200f\u200e-]/g, "")
    .trim();
}

export function isValidMobile(value: string): boolean {
  return MOBILE_PATTERN.test(value);
}

/** Loose-but-honest email shape used ONLY to route identifiers, never as the
 * authoritative validation (the authoritative email rule is zod's). */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export type ParsedIdentifier =
  | { kind: "email"; value: string }
  | { kind: "mobile"; value: string };

/**
 * Parses a login identifier into its canonical form.
 *  - Email: trimmed + lowercased (matches registration storage).
 *  - Mobile: digit-normalized to 09XXXXXXXXX (matches registration storage).
 * Returns null when the input fits neither shape — callers answer with one
 * generic, safe message (no enumeration, no format leaking).
 */
export function parseIdentifier(raw: string): ParsedIdentifier | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (value.includes("@")) {
    if (!looksLikeEmail(value)) return null;
    return { kind: "email", value: value.toLowerCase() };
  }
  const mobile = normalizeIdentifierDigits(value);
  if (!MOBILE_PATTERN.test(mobile)) return null;
  return { kind: "mobile", value: mobile };
}
