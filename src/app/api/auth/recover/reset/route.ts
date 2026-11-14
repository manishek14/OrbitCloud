// POST /api/auth/recover/reset — step 2 of password recovery.
//
// Email channel: verifies the code (atomic attempt counting), validates the
// new password policy, then consumes the grant + changes the password +
// invalidates all sessions in a single transaction.
//
// Mobile channel: verifies the SMS OTP grant (purpose "recover") then applies
// the same password policy + session invalidation. Persian/Arabic digits in
// the code are normalized server-side.

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
      // Mobile channel — verify the SMS OTP grant, then reset atomically.
      // verifyGrant normalizes Persian/Arabic digits and validates the format.
      await otpService.verifyGrant(parsed.data.mobile, "recover", code);
      // Shared canonical normalization (single source of truth) — the same
      // form the account was registered with.
      const mobile = normalizeMobile(parsed.data.mobile);
      const user = await db.panelUser.findUnique({ where: { mobile } });
      if (!user) {
        // Uniform failure — no account disclosure.
        return apiError(400, "INVALID_CODE", "کد بازیابی واردشده صحیح نیست.");
      }
      if (
        newPassword.length < 8 ||
        newPassword.length > 128 ||
        !/[A-Za-zآ-ی]/.test(newPassword) ||
        !/[0-9]/.test(newPassword)
      ) {
        return apiError(400, "WEAK_PASSWORD", "رمز عبور جدید باید حداقل ۸ نویسه و شامل حداقل یک حرف و یک رقم باشد.");
      }
      await db.$transaction(async (tx) => {
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
