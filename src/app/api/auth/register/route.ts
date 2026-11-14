// POST /api/auth/register — email + password registration, verified by a
// mobile OTP (purpose=register). The OTP is consumed together with account
// creation inside this endpoint.
//
// Validation uses the SHARED schema (src/lib/validation.ts) — the exact rules
// the client already applied before requesting the OTP. Any residual mismatch
// returns FIELD-LEVEL errors so the UI can place each message next to its
// input (never a late form-wide surprise at the OTP step).
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { otpService, normalizeMobile } from "@/lib/auth/otp";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";
import { audit } from "@/lib/audit";
import { toPublicUser } from "@/lib/api/serialize";
import { registerProfileSchema, MOBILE_MESSAGE } from "@/lib/validation";

const registerSchema = registerProfileSchema.extend({
  code: z.string().min(1, { message: "کد تأیید پیامک‌شده را وارد کنید." }).max(6),
});

export async function POST(request: Request) {
  try {
    const body = await readJson<unknown>(request);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      // Map each issue to its input field so the client can render the error
      // next to the offending input instead of a form-wide toast.
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !fields[key]) fields[key] = issue.message;
      }
      const first = parsed.error.issues[0];
      return apiError(400, "VALIDATION", first?.message ?? "اطلاعات ورودی معتبر نیست.", fields);
    }
    const data = parsed.data;

    let mobile: string;
    try {
      mobile = normalizeMobile(data.mobile);
    } catch {
      return apiError(400, "VALIDATION", MOBILE_MESSAGE, { mobile: MOBILE_MESSAGE });
    }
    const email = data.email.trim().toLowerCase();

    // Verify the registration OTP (consumes the grant).
    await otpService.verifyGrant(mobile, "register", data.code);

    const [existingEmail, existingMobile] = await Promise.all([
      db.panelUser.findUnique({ where: { email } }),
      db.panelUser.findUnique({ where: { mobile } }),
    ]);
    if (existingEmail) {
      return apiError(409, "EMAIL_TAKEN", "این ایمیل قبلاً در پنل ثبت شده است؛ وارد شوید یا ایمیل دیگری انتخاب کنید.", {
        email: "این ایمیل قبلاً ثبت شده است.",
      });
    }
    if (existingMobile) {
      return apiError(409, "MOBILE_TAKEN", "این شماره همراه قبلاً ثبت شده است؛ وارد شوید یا از بازیابی رمز استفاده کنید.", {
        mobile: "این شماره همراه قبلاً ثبت شده است.",
      });
    }

    const user = await db.panelUser.create({
      data: {
        email,
        mobile,
        name: data.name.trim(),
        passwordHash: hashPassword(data.password),
        role: "customer",
        status: "active",
        lastLoginAt: new Date(),
      },
    });

    const session = await createSession(user.id);
    await audit({ actor: user, action: "auth.register", entityType: "user", entityId: user.id });

    const response = NextResponse.json(
      { user: toPublicUser(user), redirect: "/portal" },
      { status: 201 },
    );
    response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    return handleRouteError(error, "register");
  }
}
