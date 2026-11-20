// POST /api/auth/register — email + password registration, verified by a
// mobile OTP (purpose=register). The OTP grant consumption, uniqueness
// validation and account creation run inside ONE database transaction
// (audit §4.3):
//   • the grant is consumed atomically WITH account creation — a crash or a
//     duplicate-email conflict rolls the whole transaction back, so the user
//     never loses an OTP to an unrelated failure;
//   • the pre-check outside the transaction is only a fast path; the
//     transaction itself re-validates through the unique constraints and maps
//     P2002 conflicts to honest field-level 409 errors;
//   • the session row is created in the same transaction, so a half-registered
//     account with no usable session can never exist.
//
// Validation uses the SHARED schema (src/lib/validation.ts) — the exact rules
// the client already applied before requesting the OTP. Any residual mismatch
// returns FIELD-LEVEL errors so the UI can place each message next to its
// input (never a late form-wide surprise at the OTP step).
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { otpService, normalizeMobile } from "@/lib/auth/otp";
import { SESSION_COOKIE, createSessionInTx, sessionCookieOptions } from "@/lib/auth/session";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";
import { audit } from "@/lib/audit";
import { toPublicUser } from "@/lib/api/serialize";
import { registerProfileSchema, MOBILE_MESSAGE } from "@/lib/validation";

const registerSchema = registerProfileSchema.extend({
  code: z.string().min(1, { message: "کد تأیید پیامک‌شده را وارد کنید." }).max(8),
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

    // Fast-path uniqueness check — consumes nothing, so a conflict here never
    // burns the OTP. The transaction below re-validates authoritatively.
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

    // One transaction: consume the OTP + create the account + create the
    // session. Any failure rolls everything back — including the consumption,
    // so the OTP survives unrelated database errors (audit §4.3).
    const result = await db.$transaction(async (tx) => {
      await otpService.verifyGrant(mobile, "register", data.code, tx);

      const user = await tx.panelUser.create({
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

      const session = await createSessionInTx(tx, user.id, { request });
      return { user, session };
    });

    await audit({ actor: result.user, action: "auth.register", entityType: "user", entityId: result.user.id });

    const response = NextResponse.json(
      { user: toPublicUser(result.user), redirect: "/portal" },
      { status: 201 },
    );
    response.cookies.set(SESSION_COOKIE, result.session.token, sessionCookieOptions(result.session.expiresAt));
    return response;
  } catch (error) {
    // A concurrent registration that wins the unique race surfaces as P2002 —
    // map it to the same honest field errors (the OTP is NOT consumed: the
    // transaction rolled back).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target ?? "");
      if (target.includes("email")) {
        return apiError(409, "EMAIL_TAKEN", "این ایمیل قبلاً در پنل ثبت شده است؛ وارد شوید یا ایمیل دیگری انتخاب کنید.", {
          email: "این ایمیل قبلاً ثبت شده است.",
        });
      }
      if (target.includes("mobile")) {
        return apiError(409, "MOBILE_TAKEN", "این شماره همراه قبلاً ثبت شده است؛ وارد شوید یا از بازیابی رمز استفاده کنید.", {
          mobile: "این شماره همراه قبلاً ثبت شده است.",
        });
      }
    }
    return handleRouteError(error, "register");
  }
}
