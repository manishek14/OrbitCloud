import { isIP } from "node:net";
import { HttpError } from "@/lib/api/http";

/**
 * Payment callback origin.
 * Production requires a public HTTPS origin.
 * Localhost HTTP is allowed only for explicitly enabled local testing.
 */
export function publicPaymentOrigin(
  value = process.env.ABRIT_PAYMENTS_PUBLIC_BASE_URL,
): string {
  if (!value?.trim()) {
    throw new HttpError(
      503,
      "PUBLIC_BASE_URL_MISSING",
      "آدرس بازگشت از درگاه پرداخت تنظیم نشده است.",
    );
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(
      503,
      "PUBLIC_BASE_URL_INVALID",
      "آدرس بازگشت از درگاه پرداخت معتبر نیست.",
    );
  }

  const host = url.hostname.toLowerCase();

  // Explicit local-only testing.
  // Never authorize localhost based on NODE_ENV alone.
  const allowLocalCallback =
    process.env.ABRIT_PAYMENTS_ALLOW_LOCAL_CALLBACK === "true" &&
    process.env.ABRIT_LOCAL_DEV === "true";

  if (
    allowLocalCallback &&
    url.protocol === "http:" &&
    host === "localhost" &&
    url.port === "3000" &&
    url.pathname === "/" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  ) {
    return url.origin;
  }

  if (
    url.protocol !== "https:" ||
    !host.includes(".") ||
    isIP(host) !== 0 ||
    host === "localhost" ||
    /\.(?:localhost|local|internal|test|invalid|example)$/.test(host) ||
    /(?:^|\.)(?:zarinpal\.com|zibal\.ir)$/.test(host) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443")
  ) {
    throw new HttpError(
      503,
      "PUBLIC_BASE_URL_INVALID",
      "آدرس بازگشت باید مبدأ عمومی HTTPS همین پرتال باشد.",
    );
  }

  return url.origin;
}