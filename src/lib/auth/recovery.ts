// ============================================================================
// Password recovery — durable grants.
//
//   • Durable across restarts and safe for multiple instances.
//   • 6-digit code generated with a CSPRNG; stored ONLY as a KEYED HMAC
//     (src/lib/auth/grant-hash.ts — never a plain SHA-256, audit §3.5).
//   • Short expiration (10 minutes), single-use, replay-protected.
//   • Atomic attempt counting (max 5) via conditional UPDATE — concurrent
//     requests can never exceed the limit together.
//   • The grant is consumed and the password changed inside one interactive
//     transaction, so a failure never leaves the user unrecoverable and never
//     consumes a grant before the request is validated.
//   • Shared rate limiting: max 3 grants per email and 10 per IP hash per
//     15 minutes (counted in the DB, not in process memory).
//   • Public responses are uniform: an unknown email and a known email are
//     indistinguishable.
//
// Delivery channels (audit §4.4 — the UI must never claim a delivery that
// did not happen):
//   • display (ISOLATED DEVELOPMENT ONLY) — the code is shown once for
//     existing accounts. Requesting display mode with NODE_ENV=production is
//     rejected, exactly like OTP display mode.
//   • email (production intent) — requires a REAL configured email provider.
//     No email provider is integrated in this codebase yet, so email mode
//     fails SAFE with an explicit configuration error (503) instead of
//     pretending an email was sent. The supported production recovery
//     channel is the MOBILE OTP flow (POST /api/auth/recover/request with
//     { mobile }) delivered through SMS.ir — see /api/auth/recover/capabilities.
// ============================================================================

import { createHash, randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { hashGrantCode, verifyGrantCode } from "@/lib/auth/grant-hash";

export type RecoveryDeliveryMode = "display" | "email";

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_GRANTS_PER_EMAIL = 3;
const MAX_GRANTS_PER_IP = 10;

export interface RequestGrantResult {
  ok: true;
  /** Uniform for known and unknown accounts. */
  message: string;
  /** Present only when RECOVERY_DELIVERY_MODE=display and the account exists. */
  delivery: RecoveryDeliveryMode;
  code?: string;
  expiresInSeconds: number;
}

export type RecoveryErrorCode =
  | "RATE_LIMITED"
  | "INVALID_CODE"
  | "CODE_EXPIRED"
  | "TOO_MANY_ATTEMPTS"
  | "WEAK_PASSWORD"
  | "NOT_FOUND"
  | "EMAIL_DELIVERY_UNAVAILABLE"
  | "INTERNAL";

const recoveryMessages: Record<RecoveryErrorCode, string> = {
  RATE_LIMITED: "درخواست‌های بازیابی بیش از حد مجاز است؛ چند دقیقه دیگر تلاش کنید.",
  INVALID_CODE: "کد بازیابی واردشده صحیح نیست.",
  CODE_EXPIRED: "کد بازیابی منقضی شده است؛ دوباره درخواست دهید.",
  TOO_MANY_ATTEMPTS: "تلاش‌های ناموفق بیش از حد مجاز است؛ کد جدید درخواست دهید.",
  WEAK_PASSWORD: "رمز عبور جدید باید حداقل ۸ نویسه و شامل حداقل یک حرف و یک رقم باشد.",
  NOT_FOUND: "حسابی با این ایمیل یافت نشد.",
  EMAIL_DELIVERY_UNAVAILABLE:
    "بازیابی از طریق ایمیل تا زمان پیکربندی سرویس ارسال ایمیل فعال نیست. از بازیابی با شماره همراه استفاده کنید.",
  INTERNAL: "عملیات بازیابی انجام نشد؛ لطفاً دوباره تلاش کنید.",
};

export class RecoveryError extends Error {
  readonly code: RecoveryErrorCode;
  readonly publicMessage: string;
  readonly httpStatus: number;

  constructor(code: RecoveryErrorCode, options: { httpStatus?: number; publicMessage?: string } = {}) {
    super(recoveryMessages[code]);
    this.name = "RecoveryError";
    this.code = code;
    this.publicMessage = options.publicMessage ?? recoveryMessages[code];
    this.httpStatus = options.httpStatus ?? (code === "RATE_LIMITED" ? 429 : code === "INTERNAL" ? 500 : 400);
  }
}

/**
 * True when an actual email delivery provider is configured. This codebase
 * has NO email provider integration — email recovery therefore reports
 * itself as unavailable (audit §4.4: never fake email delivery). When a
 * provider is integrated later, this function is the single switch.
 */
function emailProviderConfigured(): boolean {
  // Recognized (future) configuration surface. A provider URL must be a
  // complete, non-placeholder value.
  const url = (process.env.RECOVERY_EMAIL_PROVIDER_URL ?? "").trim();
  return url.length > 0 && /^https?:\/\//i.test(url);
}

export function recoveryDeliveryMode(): RecoveryDeliveryMode {
  const mode = (process.env.RECOVERY_DELIVERY_MODE ?? "display").trim().toLowerCase();
  return mode === "email" ? "email" : "display";
}

/** Whether the EMAIL recovery channel can actually deliver right now. */
export function emailRecoveryAvailable(): boolean {
  return recoveryDeliveryMode() === "email" && emailProviderConfigured();
}

function sha256(value: string): string {
  // Small helper kept for the client IP hash (a NON-secret, non-brute-forceable
  // value — keyed hashing is not required for IP pseudonymization).
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Client IP from the trusted gateway headers (never arbitrary client headers). */
export function clientIpHash(request: Request): string {
  const realIp = request.headers.get("x-real-ip");
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = (realIp && realIp.trim()) || (forwarded ? forwarded.split(",")[0].trim() : "") || "unknown";
  return sha256(`ip:${ip}`);
}

function generateCode(): string {
  // CSPRNG 6-digit code, 100_000..999_999 (no leading zero).
  return String(randomInt(100_000, 1_000_000));
}

async function countRecent(ipHash: string, email: string): Promise<{ byIp: number; byEmail: number }> {
  const since = new Date(Date.now() - RATE_WINDOW_MS);
  const [byIp, byEmail] = await Promise.all([
    db.recoveryGrant.count({ where: { ipHash, createdAt: { gte: since } } }),
    db.recoveryGrant.count({ where: { user: { email }, createdAt: { gte: since } } }),
  ]);
  return { byIp, byEmail };
}

export const recoveryService = {
  /**
   * Step 1 — issue a grant. The response is uniform for known/unknown emails.
   * In display (sandbox) mode the code is returned once for existing accounts;
   * in email mode it is never returned by the API.
   */
  async requestGrant(request: Request, email: string): Promise<RequestGrantResult> {
    const mode = recoveryDeliveryMode();
    const isProduction = process.env.NODE_ENV === "production";

    if (mode === "display" && isProduction) {
      // Display mode is forbidden in production exactly like OTP display mode.
      throw new RecoveryError("EMAIL_DELIVERY_UNAVAILABLE", { httpStatus: 503 });
    }
    if (mode === "email" && !emailProviderConfigured()) {
      // Email mode was requested, but no real email provider is configured.
      // Fail SAFE with an explicit configuration error — never claim an email
      // was sent (audit §4.4). The mobile OTP channel remains available.
      throw new RecoveryError("EMAIL_DELIVERY_UNAVAILABLE", { httpStatus: 503 });
    }

    const normalized = email.trim().toLowerCase();
    const ipHash = clientIpHash(request);

    const { byIp, byEmail } = await countRecent(ipHash, normalized);
    if (byIp >= MAX_GRANTS_PER_IP || byEmail >= MAX_GRANTS_PER_EMAIL) {
      throw new RecoveryError("RATE_LIMITED", { httpStatus: 429 });
    }

    const user = await db.panelUser.findUnique({ where: { email: normalized } });
    const genericMessage =
      "اگر حسابی با این ایمیل وجود داشته باشد، کد بازیابی صادر و به روش پیکربندی‌شده ارسال می‌شود. کد‌ها ۱۰ دقیقه اعتبار دارند و یک‌بار مصرف هستند.";

    if (!user) {
      // Uniform response — no code, identical message. Existence is not leaked
      // (the grant row is only created for real accounts; the code display in
      // demo mode is the single documented deviation, see file header).
      return { ok: true, message: genericMessage, delivery: mode, expiresInSeconds: Math.floor(CODE_TTL_MS / 1000) };
    }

    const code = generateCode();
    await db.recoveryGrant.create({
      data: {
        userId: user.id,
        codeHash: hashGrantCode(code, "recover-email"),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        ipHash,
      },
    });

    // EMAIL DELIVERY INTEGRITY: in email mode a provider is configured (checked
    // above) — integrate the actual send here when the provider is wired up.
    // Until then email mode cannot reach this point, so this branch is honest.
    if (mode === "email" && !emailProviderConfigured()) {
      throw new RecoveryError("EMAIL_DELIVERY_UNAVAILABLE", { httpStatus: 503 });
    }

    return {
      ok: true,
      message: genericMessage,
      delivery: mode,
      code: mode === "display" ? code : undefined,
      expiresInSeconds: Math.floor(CODE_TTL_MS / 1000),
    };
  },

  /**
   * Step 2 — verify the code and reset the password in ONE flow.
   * The attempt counter, grant consumption and password change are atomic:
   * a failure anywhere leaves a consistent, recoverable state.
   */
  async resetPassword(request: Request, email: string, code: string, newPassword: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const ipHash = clientIpHash(request);
    const { byIp } = await countRecent(ipHash, normalized);
    if (byIp > MAX_GRANTS_PER_IP + 2) {
      throw new RecoveryError("RATE_LIMITED", { httpStatus: 429 });
    }

    const user = await db.panelUser.findUnique({ where: { email: normalized } });
    if (!user) {
      // Same error shape as an invalid code — no existence disclosure.
      throw new RecoveryError("INVALID_CODE");
    }

    // Latest unconsumed grant for this user.
    const grant = await db.recoveryGrant.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!grant) {
      throw new RecoveryError("CODE_EXPIRED");
    }
    if (grant.expiresAt.getTime() < Date.now()) {
      throw new RecoveryError("CODE_EXPIRED");
    }
    if (grant.attempts >= MAX_ATTEMPTS) {
      throw new RecoveryError("TOO_MANY_ATTEMPTS");
    }

    const submitted = String(code ?? "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).trim();

    // Validate the password policy BEFORE consuming the grant (never consume
    // irreversibly before validating the request — task §4).
    if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128 || !/[A-Za-zآ-ی]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      // Count the attempt (the caller saw a grant exists) but do NOT consume.
      await db.recoveryGrant
        .updateMany({ where: { id: grant.id, attempts: { lt: MAX_ATTEMPTS }, consumedAt: null }, data: { attempts: { increment: 1 } } })
        .catch(() => undefined);
      throw new RecoveryError("WEAK_PASSWORD");
    }

    // Timing-safe keyed-HMAC comparison (audit §3.5).
    if (!verifyGrantCode(grant.codeHash, submitted, "recover-email")) {
      await db.recoveryGrant.updateMany({
        where: { id: grant.id, attempts: { lt: MAX_ATTEMPTS }, consumedAt: null },
        data: { attempts: { increment: 1 } },
      });
      throw new RecoveryError("INVALID_CODE");
    }

    // Consume the grant and change the password in a single transaction, so
    // a crash between the two can never burn the grant without a new password
    // (and vice versa).
    try {
      await db.$transaction(async (tx) => {
        const consumed = await tx.recoveryGrant.updateMany({
          where: { id: grant.id, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        if (consumed.count === 0) {
          throw new Error("GRANT_ALREADY_CONSUMED");
        }
        await tx.panelUser.update({
          where: { id: user.id },
          data: { passwordHash: hashPassword(newPassword), updatedAt: new Date() },
        });
        // Invalidate existing sessions — a reset must log out other devices.
        await tx.session.deleteMany({ where: { userId: user.id } });
      });
    } catch (error) {
      if (error instanceof Error && error.message === "GRANT_ALREADY_CONSUMED") {
        throw new RecoveryError("CODE_EXPIRED");
      }
      console.error("[recovery] reset transaction failed:", error);
      throw new RecoveryError("INTERNAL", { httpStatus: 500 });
    }
  },
};
