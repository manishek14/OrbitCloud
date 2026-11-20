// POST /api/auth/login — password login with EMAIL **or** MOBILE identifier.
//
// The identifier is parsed into its canonical form before lookup:
//   • email → trimmed + lowercased (matches registration storage)
//   • mobile → digit-normalized to 09XXXXXXXXX (matches registration storage)
// so the same account can never be ambiguously matched through inconsistent
// phone formats (۹۸/۰۹/09 formats all collapse onto one canonical value).
//
// Rate limiting (audit §4.1): failed password attempts are counted from a
// DEDICATED, indexed LoginAttempt table with SEPARATE counters —
//   • per canonical identifier (threshold 10 / 15 min)
//   • per client-IP hash      (threshold 30 / 15 min — higher, shared NATs)
// Each counter is evaluated INDEPENDENTLY; unrelated failures are never
// OR-combined into one premature throttle. The audit log remains a pure audit
// trail — it is NOT the rate-limiting database, and it never stores raw
// identifiers for failed attempts (only keyed hashes).
// Generic 401 for both unknown identifiers and wrong passwords (no account
// enumeration).
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { parseIdentifier } from "@/lib/auth/identifier";
// FSR-5: shared client-IP resolver (same module the rate limiter uses).
import { clientIpHash } from "@/lib/net/client-ip";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";
import { audit } from "@/lib/audit";
import { toPublicUser } from "@/lib/api/serialize";
import { hashLoginIdentifier } from "@/lib/auth/throttle";

const schema = z.object({
  identifier: z
    .string()
    .trim()
    .min(3, { message: "شماره تماس یا ایمیل را وارد کنید." })
    .max(190, { message: "شناسه ورود حداکثر ۱۹۰ نویسه است." }),
  password: z.string().min(1, { message: "رمز عبور را وارد کنید." }).max(128),
});

// Failed-login throttle — INDEPENDENT windows (audit §4.1).
const FAILED_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_PER_IDENTIFIER = 10;
const MAX_FAILED_PER_IP = 30;

export async function POST(request: Request) {
  try {
    const body = await readJson<unknown>(request);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return apiError(400, "VALIDATION", first?.message ?? "اطلاعات ورودی معتبر نیست.");
    }

    const identity = parseIdentifier(parsed.data.identifier);
    if (!identity) {
      // One generic message for any malformed identifier (email OR mobile).
      return apiError(
        400,
        "INVALID_IDENTIFIER",
        "یک ایمیل معتبر یا شماره همراه (۰۹xxxxxxxxx) وارد کنید.",
      );
    }

    // --- Rate limiting: dedicated table, separate per-identifier AND per-IP --
    const ipHash = clientIpHash(request);
    const identifierHash = hashLoginIdentifier(identity.kind, identity.value);
    const windowStart = new Date(Date.now() - FAILED_WINDOW_MS);
    const [failedByIdentifier, failedByIp] = await Promise.all([
      db.loginAttempt.count({
        where: { identifierHash, success: false, createdAt: { gte: windowStart } },
      }),
      db.loginAttempt.count({
        where: { ipHash, success: false, createdAt: { gte: windowStart } },
      }),
    ]);
    if (failedByIdentifier >= MAX_FAILED_PER_IDENTIFIER || failedByIp >= MAX_FAILED_PER_IP) {
      await audit({
        // Keyed hash label — raw identifiers never land in the audit trail.
        actorLabel: `id:${identifierHash.slice(0, 12)}`,
        action: "auth.login.throttled",
        entityType: "user",
        meta: { ipHash, kind: identity.kind },
      });
      return apiError(
        429,
        "TOO_MANY_ATTEMPTS",
        "تلاش‌های ناموفق زیاد بوده است؛ ۱۵ دقیقه دیگر دوباره امتحان کنید.",
      );
    }

    // Canonical single lookup: mobile and email are disjoint identifier
    // domains (mobile is strictly 09XXXXXXXXX), so exactly one branch applies.
    const user = await db.panelUser.findFirst({
      where: identity.kind === "email" ? { email: identity.value } : { mobile: identity.value },
    });
    // Constant-shape failure: never reveals whether the identifier exists.
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      // Durable throttle record (dedicated table — restart-safe, indexed).
      await db.loginAttempt
        .create({ data: { identifierHash, ipHash, success: false } })
        .catch(() => undefined);
      await audit({
        actorLabel: `id:${identifierHash.slice(0, 12)}`,
        action: "auth.login.failed",
        entityType: "user",
        meta: { ipHash, kind: identity.kind },
      });
      return apiError(401, "BAD_CREDENTIALS", "شماره تماس یا ایمیل، یا رمز عبور اشتباه است.");
    }
    if (user.status === "disabled") {
      return apiError(403, "ACCOUNT_DISABLED", "حساب کاربری شما غیرفعال است؛ با پشتیبانی تماس بگیرید.");
    }

    await db.panelUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const session = await createSession(user.id, { request });
    await audit({ actor: user, action: "auth.login.password", entityType: "user", entityId: user.id });

    const response = NextResponse.json({
      user: toPublicUser(user),
      redirect: user.role === "customer" ? "/portal" : "/admin",
    });
    response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    return handleRouteError(error, "login");
  }
}
