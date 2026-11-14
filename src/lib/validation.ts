// ============================================================================
// Shared validation schemas — the SINGLE source of validation rules.
//
// The same zod schemas run on BOTH sides:
//   • Client (register/forgot views): identical rules, applied BEFORE the OTP
//     is requested, so no challenge is ever created for invalid profile data
//     and errors surface immediately (on continue / on blur).
//   • Server (/api/auth/register): the exact same schema re-validates the
//     payload and returns FIELD-LEVEL errors, so the UI can place each message
//     next to the offending input (never a late, form-wide surprise).
//
// Persian messages are part of the contract; both sides share them verbatim.
// ============================================================================

import { z } from "zod";
import { toEnDigits } from "@/lib/format/fa";

export const EMAIL_MESSAGE = "ایمیل معتبر نیست؛ مثال: you@company.ir";
export const MOBILE_MESSAGE = "شماره همراه باید با ۰۹ شروع شود و ۱۱ رقم باشد.";
export const NAME_MESSAGE = "نام و نام خانوادگی را وارد کنید (حداقل ۲ نویسه).";
export const PASSWORD_MESSAGE = "رمز عبور باید حداقل ۸ نویسه و شامل حرف و رقم باشد.";
export const PASSWORD_CONFIRM_MESSAGE = "تکرار رمز عبور با رمز عبور یکسان نیست.";
export const TERMS_MESSAGE = "پذیرش قوانین و شرایط استفاده برای ساخت حساب الزامی است.";

/** Server-truth email rule (zod email — the same rule /api/auth/register applies). */
export const emailSchema = z.email({ message: EMAIL_MESSAGE }).max(190);

/** Normalizes Persian/Arabic digits + strips separators (mirrors the server). */
export function normalizeMobileInput(input: string): string {
  return toEnDigits(String(input ?? ""))
    .replace(/[\s-]/g, "")
    .trim();
}

export const mobileSchema = z
  .string()
  .refine((value) => /^09\d{9}$/.test(normalizeMobileInput(value)), { message: MOBILE_MESSAGE });

export const passwordSchema = z
  .string()
  .min(8, { message: PASSWORD_MESSAGE })
  .max(128, { message: "رمز عبور حداکثر ۱۲۸ نویسه می‌تواند باشد." })
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), { message: PASSWORD_MESSAGE });

export const registerProfileSchema = z.object({
  name: z.string().trim().min(2, { message: NAME_MESSAGE }).max(80),
  email: emailSchema,
  mobile: mobileSchema,
  password: passwordSchema,
});

export interface RegisterProfileForm {
  name: string;
  email: string;
  mobile: string;
  password: string;
  passwordConfirm: string;
  terms: boolean;
}

export type FieldErrors = Partial<Record<"name" | "email" | "mobile" | "password" | "passwordConfirm" | "terms", string>>;

/**
 * Client-side validation of the full profile step (runs BEFORE requesting the
 * OTP). Rules are the shared zod schemas — byte-for-byte the server's rules —
 * plus the confirm/terms UI-only checks.
 */
export function validateRegisterProfile(form: RegisterProfileForm): FieldErrors {
  const errors: FieldErrors = {};

  const nameResult = registerProfileSchema.shape.name.safeParse(form.name);
  if (!nameResult.success) errors.name = nameResult.error.issues[0]?.message ?? NAME_MESSAGE;

  const emailResult = emailSchema.safeParse(form.email.trim());
  if (!emailResult.success) errors.email = emailResult.error.issues[0]?.message ?? EMAIL_MESSAGE;

  const mobileResult = mobileSchema.safeParse(form.mobile);
  if (!mobileResult.success) errors.mobile = MOBILE_MESSAGE;

  const passwordResult = passwordSchema.safeParse(form.password);
  if (!passwordResult.success) errors.password = passwordResult.error.issues[0]?.message ?? PASSWORD_MESSAGE;

  if (form.passwordConfirm !== form.password) errors.passwordConfirm = PASSWORD_CONFIRM_MESSAGE;
  if (!form.terms) errors.terms = TERMS_MESSAGE;

  return errors;
}
