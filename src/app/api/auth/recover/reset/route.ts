// POST /api/auth/recover/reset — step 2 of password recovery.
//
// Email channel: verifies the code (atomic attempt counting), validates the
// new password policy, then consumes the grant + changes the password +
// invalidates all sessions in a single transaction.
//
// Mobile channel: the SMS OTP grant (purpose "recover") is verified and
// consumed INSIDE one transaction together with the password change and
// session invalidation (audit §4.3/§4.4 — a lookup failure or weak password
// can never burn the code). Persian/Arabic digits in the code are normalized
// server-side.

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { recoveryService, RecoveryError } from "@/lib/auth/recovery";
import { otpService, normalizeMobile } from "@/lib/auth/otp";
import { hashPassword } from "@/lib/auth/password";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";

const schema = z
  .object({
    email: z.email({ message: "ایمیل معتبر نیست." }).max(190).optional(),
    mobile: z.string().trim().min(10, { message: "شماره همراه معتبر نیست." }).max(20).optional(),
    code: z.string().trim().min(4, { message: "کد بازیابی را وارد کنید." }).max(12),
    newPassword: z.string().min(1, { message: "رمز عبور جدید را وارد کنید." }).max(128),
    confirm: z.string(),
  })
  .refine((v) => Boolean(v.email ?? v.mobile), { message: "ایمیل یا شماره همراه را وارد کنید." });

export async function POST(request: Request) {
  try {
    const body = await readJson<unknown>(request);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return apiError(400, "VALIDATION", first?.message ?? "اطلاعات ورودی معتبر نیست.");
    }
    if (parsed.data.newPassword !== parsed.data.confirm) {
      return apiError(400, "VALIDATION", "تکرار رمز عبور مطابقت ندارد.");
    }
    const { code, newPassword } = parsed.data;

    if (parsed.data.mobile) {
      // Mobile channel — one transaction: verify+consume the grant, change the
      // password, invalidate sessions (audit §4.3). The account lookup runs
      // FIRST so an unknown number never consumes a grant.
      let mobile: string;
      try {
        mobile = normalizeMobile(parsed.data.mobile);
      } catch {
        return apiError(400, "VALIDATION", "شماره همراه معتبر نیست.");
      }
      if (
        newPassword.length < 8 ||
        newPassword.length > 128 ||
        !/[A-Za-zآ-ی]/.test(newPassword) ||
        !/[0-9]/.test(newPassword)
      ) {
        return apiError(400, "WEAK_PASSWORD", "رمز عبور جدید باید حداقل ۸ نویسه و شامل حداقل یک حرف و یک رقم باشد.");
      }
      const user = await db.panelUser.findUnique({ where: { mobile } });
      if (!user) {
        // Uniform failure — no account disclosure, grant untouched.
        return apiError(400, "INVALID_CODE", "کد بازیابی واردشده صحیح نیست.");
      }

      await db.$transaction(async (tx) => {
        // verifyGrant consumes the grant inside THIS transaction.
        await otpService.verifyGrant(mobile, "recover", code, tx);
        await tx.panelUser.update({
          where: { id: user.id },
          data: { passwordHash: hashPassword(newPassword), updatedAt: new Date() },
        });
        await tx.session.deleteMany({ where: { userId: user.id } });
      });
      return NextResponse.json(
        { ok: true, message: "رمز عبور با موفقیت تغییر کرد. حالا با رمز جدید وارد شوید." },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    await recoveryService.resetPassword(request, parsed.data.email as string, code, newPassword);
    return NextResponse.json(
      { ok: true, message: "رمز عبور با موفقیت تغییر کرد. حالا با رمز جدید وارد شوید." },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof RecoveryError) {
      return apiError(error.httpStatus, error.code, error.publicMessage);
    }
    return handleRouteError(error, "recover/reset");
  }
}
