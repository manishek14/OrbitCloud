"use client";

// بازیابی رمز عبور — step 1 of the recovery flow: request a recovery code
// for the registered email. Step 2 (defining a new password) lives in the
// reset-password view.

import { useState } from "react";
import { CheckCircle2, Copy, KeyRound, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useRecoverRequest } from "@/lib/api/hooks";
import { errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { FormField, TextField } from "@/components/abrit/form-field";
import { useCopyToClipboard } from "@/components/abrit/otp-input";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordView() {
  const router = useRouter();
  const recoverRequest = useRecoverRequest();
  const copyToClipboard = useCopyToClipboard();

  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; code?: string } | null>(null);

  const handleSubmit = () => {
    const normalized = email.trim();
    if (!EMAIL_RE.test(normalized)) {
      setEmailError("ایمیل معتبر نیست؛ مثال: you@company.ir");
      return;
    }
    recoverRequest.mutate(
      { email: normalized },
      {
        onSuccess: (response) => {
          setResult({ message: response.message, code: response.delivery === "display" ? response.code : undefined });
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  return (
    <div>
      <div className="mb-8 text-center">
        <span className="mx-auto inline-flex rounded-xl bg-primary/10 p-3 text-primary">
          <KeyRound className="size-5" />
        </span>
        <h1 className="mt-4 text-xl font-extrabold md:text-2xl">بازیابی رمز عبور</h1>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          کد بازیابی به ایمیل ثبت‌شده شما ارسال می‌شود.
        </p>
      </div>

      {result ? (
        <div className="space-y-5">
          <div className="flex flex-col items-center rounded-2xl border border-success/30 bg-success/5 px-5 py-8 text-center">
            <span className="rounded-full bg-success/10 p-3.5 text-success">
              <CheckCircle2 className="size-7" />
            </span>
            <h2 className="mt-4 text-sm font-extrabold">درخواست بازیابی ثبت شد</h2>
            <p className="mt-2 max-w-sm text-xs leading-6 text-muted-foreground">{result.message}</p>
          </div>

          {result.code ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[11px] font-bold text-warning">
              <p className="leading-6">
                محیط نمایشی: کد بازیابی شما <span className="ltr-iso tracking-widest" dir="ltr">{result.code}</span> است
              </p>
              <button
                type="button"
                onClick={() => copyToClipboard(result.code as string, "کد بازیابی کپی شد.")}
                className="shrink-0 rounded-lg border border-warning/40 p-1.5 transition-colors hover:bg-warning/20"
                aria-label="کپی کد بازیابی"
              >
                <Copy className="size-3.5" />
              </button>
            </div>
          ) : null}

          <Button
            className="w-full gap-2"
            size="lg"
            onClick={() => router.navigate(`${routes.resetPassword}?email=${encodeURIComponent(email.trim())}`)}
          >
            <MailCheck className="size-4" />
            رفتن به صفحه تعیین رمز
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <FormField
            label="ایمیل حساب کاربری"
            htmlFor="forgot-email"
            required
            error={emailError}
            hint="همان ایمیلی که با آن ثبت‌نام کرده‌اید."
          >
            <TextField
              id="forgot-email"
              type="email"
              inputMode="email"
              dir="ltr"
              value={email}
              invalid={Boolean(emailError)}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              placeholder="you@company.ir"
            />
          </FormField>

          <Button className="w-full" size="lg" disabled={recoverRequest.isPending} onClick={handleSubmit}>
            {recoverRequest.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            دریافت کد بازیابی
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
