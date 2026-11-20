"use client";

// تعیین رمز عبور جدید — step 2 of the recovery flow. Supports BOTH channels:
//   • mobile — SMS OTP (purpose=recover) + new password (production channel)
//   • email  — emailed/displayed recovery code + new password
// The channel is selected by the query parameter handed over from the
// forgot-password view (?mobile=… | ?email=…).

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { api, errorMessage, ApiRequestError } from "@/lib/api/client";
import { toEnDigits } from "@/lib/format/fa";
import { Button } from "@/components/ui/button";
import { FormField, TextField } from "@/components/abrit/form-field";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^09\d{9}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const CODE_RE = /^\d{4,8}$/;

function normalizeMobileInput(value: string): string {
  return toEnDigits(value).replace(/[\s\u200c-]/g, "");
}

interface ResetFormState {
  identifier: string; // email or mobile depending on channel
  code: string;
  password: string;
  passwordConfirm: string;
}

type ResetFormErrors = Partial<Record<keyof ResetFormState, string>>;

export default function ResetPasswordView() {
  const router = useRouter();

  const channel: "mobile" | "email" = router.query.mobile ? "mobile" : "email";
  const initialIdentifier =
    channel === "mobile" ? normalizeMobileInput(router.query.mobile ?? "") : (router.query.email ?? "").trim();

  const recoverReset = useMutation({
    mutationFn: (input: { identifier: string; code: string; newPassword: string }) =>
      api.post<{ ok: true; message: string }>("/api/auth/recover/reset", {
        ...(channel === "mobile" ? { mobile: input.identifier } : { email: input.identifier }),
        code: input.code,
        newPassword: input.newPassword,
        confirm: input.newPassword,
      }),
  });

  const [form, setForm] = useState<ResetFormState>({
    identifier: initialIdentifier,
    code: "",
    password: "",
    passwordConfirm: "",
  });
  const [errors, setErrors] = useState<ResetFormErrors>({});
  const [done, setDone] = useState(false);

  const setField = (field: keyof ResetFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = (): boolean => {
    const next: ResetFormErrors = {};
    if (channel === "mobile") {
      if (!MOBILE_RE.test(normalizeMobileInput(form.identifier))) {
        next.identifier = "شماره همراه باید با ۰۹ شروع شود و ۱۱ رقم باشد.";
      }
    } else if (!EMAIL_RE.test(form.identifier.trim())) {
      next.identifier = "ایمیل معتبر نیست؛ مثال: you@company.ir";
    }
    if (!CODE_RE.test(toEnDigits(form.code).trim())) next.code = "کد بازیابی را کامل وارد کنید.";
    if (!PASSWORD_RE.test(form.password)) next.password = "رمز عبور باید حداقل ۸ نویسه و شامل حرف و رقم باشد.";
    if (form.passwordConfirm !== form.password) next.passwordConfirm = "تکرار رمز عبور با رمز عبور جدید یکسان نیست.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    recoverReset.mutate(
      {
        identifier: channel === "mobile" ? normalizeMobileInput(form.identifier) : form.identifier.trim(),
        code: toEnDigits(form.code).trim(),
        newPassword: form.password,
      },
      {
        onSuccess: () => {
          setDone(true);
          toast.success("رمز عبور با موفقیت تغییر کرد؛ وارد شوید.");
        },
        onError: (error) => {
          toast.error(errorMessage(error));
          // Inline field errors where the cause is obvious.
          if (error instanceof ApiRequestError) {
            if (["INVALID_CODE", "CODE_EXPIRED", "TOO_MANY_ATTEMPTS"].includes(error.code)) {
              setErrors((prev) => ({ ...prev, code: error.message }));
            } else if (error.code === "WEAK_PASSWORD") {
              setErrors((prev) => ({ ...prev, password: error.message }));
            }
          }
        },
      },
    );
  };

  return (
    <div>
      <div className="mb-8 text-center">
        <span className="mx-auto inline-flex rounded-xl bg-primary/10 p-3 text-primary">
          <KeyRound className="size-5" />
        </span>
        <h1 className="mt-4 text-xl font-extrabold md:text-2xl">تعیین رمز عبور جدید</h1>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          {channel === "mobile"
            ? "کد بازیابی پیامک‌شده به شماره همراه خود و رمز عبور جدید را وارد کنید."
            : "کد بازیابی ارسال‌شده به ایمیل خود و رمز عبور جدید را وارد کنید."}
        </p>
      </div>

      {done ? (
        <div className="space-y-5">
          <div className="flex flex-col items-center rounded-2xl border border-success/30 bg-success/5 px-5 py-8 text-center">
            <span className="rounded-full bg-success/10 p-3.5 text-success">
              <CheckCircle2 className="size-7" />
            </span>
            <h2 className="mt-4 text-sm font-extrabold">رمز عبور با موفقیت تغییر کرد</h2>
            <p className="mt-2 max-w-sm text-xs leading-6 text-muted-foreground">
              حالا می‌توانید با ایمیل و رمز عبور جدید — یا شماره موبایل و کد یک‌بار مصرف — وارد حساب خود شوید.
            </p>
          </div>
          <Button className="w-full gap-2" size="lg" onClick={() => router.navigate(routes.login)}>
            <LogIn className="size-4" />
            رفتن به صفحه ورود
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <FormField
            label={channel === "mobile" ? "شماره همراه" : "ایمیل"}
            htmlFor="reset-identifier"
            required
            error={errors.identifier ?? null}
          >
            <TextField
              id="reset-identifier"
              type={channel === "mobile" ? "tel" : "email"}
              inputMode={channel === "mobile" ? "tel" : "email"}
              dir="ltr"
              value={form.identifier}
              invalid={Boolean(errors.identifier)}
              onChange={(e) => setField("identifier", e.target.value)}
              placeholder={channel === "mobile" ? "09121234567" : "you@company.ir"}
            />
          </FormField>

          <FormField
            label="کد بازیابی"
            htmlFor="reset-code"
            required
            error={errors.code ?? null}
            hint={channel === "mobile" ? "کد پیامک‌شده به شماره همراه شما." : "کد ارسال‌شده به ایمیل شما."}
          >
            <TextField
              id="reset-code"
              inputMode="numeric"
              dir="ltr"
              className="text-center tracking-widest"
              value={form.code}
              invalid={Boolean(errors.code)}
              onChange={(e) => setField("code", e.target.value)}
              placeholder="------"
              maxLength={8}
            />
          </FormField>

          <FormField
            label="رمز عبور جدید"
            htmlFor="reset-password"
            required
            error={errors.password ?? null}
            hint="حداقل ۸ نویسه، شامل حداقل یک حرف و یک رقم."
          >
            <TextField
              id="reset-password"
              type="password"
              dir="ltr"
              value={form.password}
              invalid={Boolean(errors.password)}
              onChange={(e) => setField("password", e.target.value)}
            />
          </FormField>

          <FormField label="تکرار رمز عبور" htmlFor="reset-password-confirm" required error={errors.passwordConfirm ?? null}>
            <TextField
              id="reset-password-confirm"
              type="password"
              dir="ltr"
              value={form.passwordConfirm}
              invalid={Boolean(errors.passwordConfirm)}
              onChange={(e) => setField("passwordConfirm", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
          </FormField>

          <Button className="w-full" size="lg" disabled={recoverReset.isPending} onClick={handleSubmit}>
            {recoverReset.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            تغییر رمز عبور
          </Button>
        </div>
      )}

      <div className="mt-6 text-center text-[11px]">
        <Link to={routes.login} className="font-bold text-primary hover:text-primary/80">
          بازگشت به صفحه ورود
        </Link>
      </div>
    </div>
  );
}
