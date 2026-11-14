// POST /api/auth/otp/verify — verify the login OTP and establish a session.
// (Registration OTP is verified by /api/auth/register together with account
// creation, so a code can never be spent on the wrong purpose.)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { otpService, normalizeMobile } from "@/lib/auth/otp";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { apiError, handleRouteError, readJson, HttpError } from "@/lib/api/http";
import { audit } from "@/lib/audit";
import { toPublicUser } from "@/lib/api/serialize";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ mobile?: string; code?: string }>(request);
    const code = String(body?.code ?? "");
    if (!body?.mobile || !code) {
      return apiError(400, "VALIDATION", "شماره همراه و کد تأیید را وارد کنید.");
    }

    await otpService.verifyGrant(body.mobile, "login", code);

    // Canonical lookup: normalize BEFORE the user query so Persian/Arabic
    // digits or separators in the payload can never split one account across
    // inconsistent formats (verifyGrant normalizes internally as well).
    const mobile = normalizeMobile(body.mobile);
    const user = await db.panelUser.findUnique({ where: { mobile } });
    if (!user) {
      throw new HttpError(404, "USER_NOT_FOUND", "حسابی با این شماره همراه یافت نشد؛ ابتدا ثبت‌نام کنید.");
    }
    if (user.status === "disabled") {
      throw new HttpError(403, "ACCOUNT_DISABLED", "حساب کاربری شما غیرفعال است؛ با پشتیبانی تماس بگیرید.");
    }

    await db.panelUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const session = await createSession(user.id);
    await audit({ actor: user, action: "auth.login.otp", entityType: "user", entityId: user.id });

    const response = NextResponse.json({
      user: toPublicUser(user),
      redirect: user.role === "customer" ? "/portal" : "/admin",
    });
    response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    return handleRouteError(error, "auth/otp/verify");
  }
}
