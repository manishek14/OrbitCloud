// ============================================================================
// Mobile OTP grants — first-class mobile-number authentication.
//
// Durable, secure design:
//   • CSPRNG numeric code (OTP_CODE_LENGTH digits, default 6) stored ONLY as a
//     KEYED HMAC-SHA256 (src/lib/auth/grant-hash.ts) — never plaintext, never
//     a plain hash, never in logs.
//   • Short TTL (default 2 minutes), single-use, atomic attempt counting.
//   • Rate limits: max 3 grants per mobile and 10 per IP hash per 15 minutes.
//   • Persian/Arabic digit normalization server-side.
//   • Purposes: login | register | recover (mobile password recovery).
//
// Request ordering (audit §4.2 — a server misconfiguration must never consume
// a user's rate-limit allowance):
//   1. validate the request (mobile format)
//   2. validate the OTP delivery configuration
//   3. check the rate limits
//   4. create the grant
//   5. attempt provider delivery
//   6. record the delivery result (durable outbox, metadata only)
//   7. when delivery definitively fails, invalidate the grant so it can never
//      be verified later, while keeping it counted toward the rate limit
//      (a failing provider must not become an unlimited-request loophole).
//
// Delivery modes:
//   • "sms" (PRODUCTION) — the code is delivered through the SMS.ir Verify
//     API (src/lib/sms/smsir.ts). The API response NEVER contains the code.
//     If the provider is not configured, the request fails SAFE with a clear
//     configuration error — there is NO silent fallback to displaying codes.
//     Every attempt is recorded in the durable SmsOutbox (metadata only).
//   • "display" (ISOLATED DEVELOPMENT/TEST ONLY) — the code is returned once
//     in the API response and clearly labeled in the UI. Requesting display
//     mode in a production build is rejected.
// ============================================================================

import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/api/http";
import { clientIpHash } from "@/lib/auth/recovery";
import { sendVerifyOtp, getSmsIrConfig } from "@/lib/sms/smsir";
import { MOBILE_PATTERN, normalizeIdentifierDigits } from "@/lib/auth/identifier";
import { hashGrantCode, verifyGrantCode } from "@/lib/auth/grant-hash";
import type { PrismaTransactionClient } from "@/lib/db";

export type OtpPurpose = "login" | "register" | "recover";
export type OtpDeliveryMode = "display" | "sms";

// ---------------------------------------------------------------------------
// Operational tuning (environment-configurable, production-safe defaults):
//   OTP_CODE_LENGTH              default 6 (4..8, audit §4.5 — the generator
//                                and the verifier both honor this value)
//   OTP_EXPIRY_SECONDS           default 120
//   OTP_MAX_ATTEMPTS             default 3
//   OTP_RESEND_COOLDOWN_SECONDS  default 60
//   OTP_PROVIDER                 alias of OTP_DELIVERY_MODE ("sms" | "display")
// Hard floors keep the configuration safe even if a value is set too low.
// ---------------------------------------------------------------------------
function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  const value = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

const CODE_TTL_MS = envNumber("OTP_EXPIRY_SECONDS", 120, 60, 600) * 1000;
const MAX_ATTEMPTS = envNumber("OTP_MAX_ATTEMPTS", 3, 1, 10);
const RESEND_COOLDOWN_SECONDS = envNumber("OTP_RESEND_COOLDOWN_SECONDS", 60, 15, 300);
/** Code length is shared by the generator and the verifier — a single source
 *  of truth so the configured length is actually enforced (audit §4.5). */
export const OTP_CODE_LENGTH = envNumber("OTP_CODE_LENGTH", 6, 4, 8);
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_GRANTS_PER_MOBILE = 3;
const MAX_GRANTS_PER_IP = 10;

const MOBILE_RE = MOBILE_PATTERN;

export function otpDeliveryMode(): OtpDeliveryMode {
  // OTP_PROVIDER is the documented alias of OTP_DELIVERY_MODE.
  const requested = (process.env.OTP_DELIVERY_MODE ?? process.env.OTP_PROVIDER ?? "").trim().toLowerCase();
  const isProduction = process.env.NODE_ENV === "production";
  if (requested === "sms") return "sms";
  if (requested === "display") {
    // Display mode is only allowed in explicitly isolated development/test
    // environments — never in production.
    if (isProduction) {
      throw new HttpError(
        500,
        "OTP_DISPLAY_FORBIDDEN_IN_PRODUCTION",
        "حالت نمایش کد تأیید در محیط تولید مجاز نیست؛ OTP_DELIVERY_MODE=sms و پیکربندی SMS.ir الزامی است.",
      );
    }
    return "display";
  }
  // Default: real SMS delivery in production, display only in development.
  return isProduction ? "sms" : "display";
}

/** Normalizes Persian/Arabic digits and validates the 09xxxxxxxxx format. */
export function normalizeMobile(input: string): string {
  const normalized = normalizeIdentifierDigits(input);
  if (!MOBILE_RE.test(normalized)) {
    throw new HttpError(400, "INVALID_MOBILE", "شماره همراه باید با ۰۹ شروع شود و ۱۱ رقم باشد.");
  }
  return normalized;
}

function normalizeCode(input: string): string {
  return String(input ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\s/g, "")
    .trim();
}

/** Generates a CSPRNG code of the configured length (no leading zero, so the
 *  digit space stays uniform across all supported lengths). */
function generateCode(): string {
  const min = 10 ** (OTP_CODE_LENGTH - 1);
  const max = 10 ** OTP_CODE_LENGTH;
  return String(randomInt(min, max));
}

export interface OtpRequestResult {
  ok: true;
  message: string;
  delivery: OtpDeliveryMode;
  /** Provider accepted the request; handset delivery is not confirmed. */
  providerAccepted?: boolean;
  /** Present ONLY in isolated development display mode (clearly labeled in the UI). */
  code?: string;
  expiresInSeconds: number;
  /** Seconds before another code may be requested (UI resend countdown). */
  resendCooldownSeconds: number;
  /** Configured code length — lets the UI render the right number of inputs
   *  for non-default OTP_CODE_LENGTH values (audit §4.5). */
  codeLength: number;
}

/** Records a delivery attempt in the durable outbox (metadata only — never the code). */
async function recordOutbox(purpose: OtpPurpose, mobile: string, result: Awaited<ReturnType<typeof sendVerifyOtp>>, idempotencyKey: string): Promise<void> {
  try {
    await db.smsOutbox.upsert({
      where: { idempotencyKey },
      update: {
        status: result.ok ? "submitted" : "failed",
        attempts: { increment: 1 },
        messageId: result.ok ? String(result.messageId ?? "") || null : null,
        lastError: result.ok ? null : result.message,
        sentAt: null,
      },
      create: {
        purpose: `otp_${purpose}`,
        mobile,
        provider: "smsir",
        status: result.ok ? "submitted" : "failed",
        attempts: 1,
        idempotencyKey,
        messageId: result.ok ? String(result.messageId ?? "") || null : null,
        lastError: result.ok ? null : result.message,
        sentAt: null,
      },
    });
  } catch {
    // Outbox bookkeeping must never block authentication; the failure is
    // visible through monitoring of the outbox table itself.
  }
}

export const otpService = {
  /**
   * Step 1 — issue an OTP for login, registration, or mobile password
   * recovery and deliver it through the configured channel.
   */
  async requestGrant(request: Request, mobileInput: string, purpose: OtpPurpose, correlationId?: string): Promise<OtpRequestResult> {
    // (1) Validate the request.
    const mobile = normalizeMobile(mobileInput);

    // (2) Validate the delivery configuration BEFORE creating any state — a
    // missing SMS.ir configuration must not consume rate-limit allowance or
    // leave dead grants behind (audit §4.2).
    const mode = otpDeliveryMode();
    if (mode === "sms" && !getSmsIrConfig().configured) {
      throw new HttpError(
        503,
        "SMS_NOT_CONFIGURED",
        "سرویس پیامک پیکربندی نشده است؛ ورود با کد پیامکی فعلاً امکان‌پذیر نیست. (خطای پیکربندی سرور: SMSIR_API_KEY / SMSIR_OTP_TEMPLATE_ID)",
      );
    }

    // (3) Rate limits (counted from durable grant rows).
    const ipHash = clientIpHash(request);
    const since = new Date(Date.now() - RATE_WINDOW_MS);
    const [byMobile, byIp] = await Promise.all([
      db.otpGrant.count({ where: { mobile, createdAt: { gte: since } } }),
      db.otpGrant.count({ where: { ipHash, createdAt: { gte: since } } }),
    ]);
    if (byMobile >= MAX_GRANTS_PER_MOBILE || byIp >= MAX_GRANTS_PER_IP) {
      throw new HttpError(429, "RATE_LIMITED", "درخواست‌های کد تأیید بیش از حد مجاز است؛ چند دقیقه دیگر تلاش کنید.");
    }

    // For recovery we only create a grant when an account with this mobile
    // exists — but the response stays uniform (no account enumeration).
    if (purpose === "recover") {
      const user = await db.panelUser.findUnique({ where: { mobile } });
      if (!user) {
        return {
          ok: true,
          message: "اگر حسابی با این شماره همراه وجود داشته باشد، کد بازیابی ارسال می‌شود.",
          delivery: mode,
          expiresInSeconds: Math.floor(CODE_TTL_MS / 1000),
          resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
          codeLength: OTP_CODE_LENGTH,
        };
      }
    }

    // (4) Create the grant (keyed HMAC — never a plain hash).
    const code = generateCode();
    const grant = await db.otpGrant.create({
      data: {
        mobile,
        purpose,
        codeHash: hashGrantCode(code, purpose),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        ipHash,
      },
    });

    if (mode === "sms") {
      // (5) Attempt delivery.
      const result = await sendVerifyOtp(mobile, code, correlationId);
      // (6) Record the delivery result (metadata only).
      await recordOutbox(purpose, mobile, result, `otp:${grant.id}`);
      console.info("[otp.delivery]", { correlationId, purpose, stage: "provider_result", accepted: result.ok, kind: result.ok ? null : result.kind, messageIdPresent: result.ok && !!result.messageId });
      if (!result.ok) {
        // (7) Delivery definitively failed — invalidate the grant so it can
        // never be verified, but keep the row (it still counts toward the
        // rate limit; a failing provider must not open an unlimited loop).
        await db.otpGrant
          .updateMany({ where: { id: grant.id, consumedAt: null }, data: { consumedAt: new Date(), attempts: MAX_ATTEMPTS } })
          .catch(() => undefined);
        if (result.kind === "not_configured") {
          throw new HttpError(503, "SMS_NOT_CONFIGURED", result.message);
        }
        throw new HttpError(502, "SMS_SEND_FAILED", `${result.message} لطفاً چند لحظه بعد دوباره درخواست دهید.`);
      }
      return {
        ok: true,
        message: "درخواست ارسال کد توسط سرویس پیامک پذیرفته شد. رسیدن پیامک به گوشی هنوز تأیید نشده است.",
        delivery: "sms",
        providerAccepted: true,
        expiresInSeconds: Math.floor(CODE_TTL_MS / 1000),
        resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
        codeLength: OTP_CODE_LENGTH,
      };
    }

    // Isolated development display mode (never in production).
    return {
      ok: true,
      message:
        purpose === "login"
          ? "کد تأیید برای ورود صادر شد. کد یک‌بار مصرف است و تا زمان اعلام‌شده اعتبار دارد."
          : purpose === "register"
            ? "کد تأیید برای تکمیل ثبت‌نام صادر شد. کد یک‌بار مصرف است و تا زمان اعلام‌شده اعتبار دارد."
            : "کد بازیابی صادر شد. کد یک‌بار مصرف است و تا زمان اعلام‌شده اعتبار دارد.",
      delivery: "display",
      code,
      expiresInSeconds: Math.floor(CODE_TTL_MS / 1000),
      resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
      codeLength: OTP_CODE_LENGTH,
    };
  },

  /**
   * Step 2 — verify an OTP against the latest unconsumed grant for the
   * mobile+purpose pair. Consumes the grant on success (single-use).
   *
   * Atomic, transaction-aware implementation: pass a transaction client to
   * consume the grant atomically with a follow-up operation (e.g. account
   * creation in /api/auth/register, audit §4.3). Omit it for standalone use.
   */
  async verifyGrant(
    mobileInput: string,
    purpose: OtpPurpose,
    codeInput: string,
    tx?: PrismaTransactionClient,
  ): Promise<void> {
    const client = tx ?? db;
    const mobile = normalizeMobile(mobileInput);
    const code = normalizeCode(codeInput);
    if (!new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`).test(code)) {
      throw new HttpError(400, "INVALID_CODE", "کد تأیید واردشده صحیح نیست.");
    }

    const grant = await client.otpGrant.findFirst({
      where: { mobile, purpose, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!grant || grant.expiresAt.getTime() < Date.now()) {
      throw new HttpError(400, "CODE_EXPIRED", "کد تأیید منقضی شده است؛ دوباره درخواست دهید.");
    }
    if (grant.attempts >= MAX_ATTEMPTS) {
      throw new HttpError(429, "TOO_MANY_ATTEMPTS", "تلاش‌های ناموفق بیش از حد مجاز است؛ کد جدید درخواست دهید.");
    }

    // Timing-safe, keyed-HMAC comparison (audit §3.5).
    if (!verifyGrantCode(grant.codeHash, code, purpose)) {
      // Count the failed attempt atomically; the grant is NOT consumed so the
      // user can retry within MAX_ATTEMPTS.
      await client.otpGrant.updateMany({
        where: { id: grant.id, attempts: { lt: MAX_ATTEMPTS }, consumedAt: null },
        data: { attempts: { increment: 1 } },
      });
      throw new HttpError(400, "INVALID_CODE", "کد تأیید واردشده صحیح نیست.");
    }

    const consumed = await client.otpGrant.updateMany({
      where: { id: grant.id, consumedAt: null },
      data: { consumedAt: new Date(), attempts: { increment: 1 } },
    });
    if (consumed.count === 0) {
      throw new HttpError(400, "CODE_EXPIRED", "کد تأیید منقضی شده است؛ دوباره درخواست دهید.");
    }
  },
};
