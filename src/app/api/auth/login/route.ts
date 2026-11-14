// POST /api/auth/login — password login with EMAIL **or** MOBILE identifier.
//
// The identifier is parsed into its canonical form before lookup:
//   • email → trimmed + lowercased (matches registration storage)
//   • mobile → digit-normalized to 09XXXXXXXXX (matches registration storage)
// so the same account can never be ambiguously matched through inconsistent
// phone formats (۹۸/۰۹/09 formats all collapse onto one canonical value).
//
// Rate limiting: failed password attempts are counted from the durable audit
// log per identifier AND per client-IP hash over a 15-minute window — no
// in-memory state, safe across restarts. Generic 401 for both unknown
// identifiers and wrong passwords (no account enumeration).
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { parseIdentifier } from "@/lib/auth/identifier";
import { clientIpHash } from "@/lib/auth/recovery";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";
import { audit } from "@/lib/audit";
import { toPublicUser } from "@/lib/api/serialize";

const schema = z.object({
  identifier: z
    .string()
    .trim()
    .min(3, { message: "شماره تماس یا ایمیل را وارد کنید." })
    .max(190, { message: "شناسه ورود حداکثر ۱۹۰ نویسه است." }),
  password: z.string().min(1, { message: "رمز عبور را وارد کنید." }).max(128),
});

// Failed-login throttle (per identifier and per IP, 15-minute window).
const FAILED_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;

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
    const identifierLabel = identity.value;

    // --- Rate limiting: durable, per-identifier AND per-IP -----------------
    const ipHash = clientIpHash(request);
    const windowStart = new Date(Date.now() - FAILED_WINDOW_MS);
    const failed = await db.auditLog.count({
      where: {
        action: "auth.login.failed",
        createdAt: { gte: windowStart },
        OR: [{ actorLabel: identifierLabel }, { metaJson: { contains: ipHash } }],
      },
    });
    if (failed >= MAX_FAILED_ATTEMPTS) {
      await audit({
        actorLabel: identifierLabel,
        action: "auth.login.throttled",
        entityType: "user",
        meta: { ipHash },
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
      await audit({
        actorLabel: identifierLabel,
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
    const session = await createSession(user.id);
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
