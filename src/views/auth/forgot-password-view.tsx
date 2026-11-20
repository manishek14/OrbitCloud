"use client";

// بازیابی رمز عبور — step 1 of the recovery flow. Two channels:
//   • شماره همراه (SMS OTP, purpose=recover) — the PRODUCTION channel.
//   • ایمیل — only when a real email provider is configured (the UI checks
//     /api/auth/recover/capabilities and never offers a channel that cannot
//     deliver — audit §4.4).
// Step 2 (defining a new password) lives in the reset-password view.

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, KeyRound, Loader2, MailCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useRecoverRequest, useRequestOtp } from "@/lib/api/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { toEnDigits } from "@/lib/format/fa";
import { Button } from "@/components/ui/button";
import { FormField, TextField } from "@/components/abrit/form-field";
import { useCopyToClipboard } from "@/components/abrit/otp-input";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^09\d{9}$/;

function normalizeMobileInput(value: string): string {
  return toEnDigits(value).replace(/[\s\u200c-]/g, "");
}

export default function ForgotPasswordView() {
  const router = useRouter();
  const recoverRequest = useRecoverRequest();
  const requestOtp = useRequestOtp();
  const copyToClipboard = useCopyToClipboard();

  // Real delivery capabilities — the UI never implies a channel that cannot
  // deliver (audit §4.4).
  const [capabilities, setCapabilities] = useState<{ mobile: boolean; email: boolean } | null>(null);
  const [channel, setChannel] = useState<"mobile" | "email">("mobile");

  const [mobile, setMobile] = useState("");
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; code?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ channels: { mobile: boolean; email: boolean } }>("/api/auth/recover/capabilities")
      .then((data) => {
        if (cancelled) return;
        setCapabilities(data.channels);
        // Prefer the mobile channel; fall back to email when SMS is not
        // configured and email is.
        if (!data.channels.mobile && data.channels.email) setChannel("email");
      })
      .catch(() => {
        if (!cancelled) setCapabilities({ mobile: true, email: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = () => {
    if (channel === "mobile") {
      const normalized = normalizeMobileInput(mobile);
      if (!MOBILE_RE.test(normalized)) {
        setMobileError("شماره همراه باید با ۰۹ شروع شود و ۱۱ رقم باشد.");
        return;
      }
      requestOtp.mutate(
        { mobile: normalized, purpose: "recover" },
        {
          onSuccess: (response) => {
            setResult({
              message: response.message,
              code: response.delivery === "display" ? response.code : undefined,
            });
          },
          onError: (error) => toast.error(errorMessage(error)),
        },
      );
      return;
    }
    const normalized = email.trim();
    if (!EMAIL_RE.test(normalized)) {
      setEmailError("ایمیل معتبر نیست؛ مثال: you@company.ir");
      return;
    }
    recoverRequest.mutate(
      { email: normalized },
      {
        onSuccess: (response) => {
          setResult({
            message: response.message,
            code: response.delivery === "display" ? response.code : undefined,
          });
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  const pending = channel === "mobile" ? requestOtp.isPending : recoverRequest.isPending;

  const gotoReset = () => {
    if (channel === "mobile") {
      router.navigate(`${routes.resetPassword}?mobile=${encodeURIComponent(normalizeMobileInput(mobile))}`);
    } else {
      router.navigate(`${routes.resetPassword}?email=${encodeURIComponent(email.trim())}`);
    }
  };

  return (
    <div>
      <div className="mb-8 text-center">
        <span className="mx-auto inline-flex rounded-xl bg-primary/10 p-3 text-primary">
          <KeyRound className="size-5" />
        </span>
        <h1 className="mt-4 text-xl font-extrabold md:text-2xl">بازیابی رمز عبور</h1>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          کد بازیابی به شماره همراه یا ایمیل ثبت‌شده شما ارسال می‌شود.
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

          <Button className="w-full gap-2" size="lg" onClick={gotoReset}>
            {channel === "mobile" ? <Smartphone className="size-4" /> : <MailCheck className="size-4" />}
            رفتن به صفحه تعیین رمز
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Channel selection — only channels that can ACTUALLY deliver. */}
          <div role="tablist" aria-label="روش بازیابی" className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
            <button
              type="button"
              role="tab"
              aria-selected={channel === "mobile"}
              disabled={capabilities !== null && !capabilities.mobile}
              onClick={() => setChannel("mobile")}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                channel === "mobile" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Smartphone className="size-3.5" />
              شماره همراه
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={channel === "email"}
              disabled={capabilities !== null && !capabilities.email}
              onClick={() => setChannel("email")}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                channel === "email" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MailCheck className="size-3.5" />
              ایمیل
            </button>
          </div>

          {capabilities !== null && !capabilities.mobile && !capabilities.email ? (
            <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[11px] font-bold leading-6 text-warning">
              فعلاً هیچ کانال بازیابی پیکربندی نشده است؛ با پشتیبانی تماس بگیرید.
            </p>
          ) : null}

          {channel === "mobile" ? (
            <FormField
              label="شماره همراه حساب کاربری"
              htmlFor="forgot-mobile"
              required
              error={mobileError}
              hint="همان شماره‌ای که با آن ثبت‌نام کرده‌اید (۰۹xxxxxxxxx)."
            >
              <TextField
                id="forgot-mobile"
                type="tel"
                inputMode="tel"
                dir="ltr"
                value={mobile}
                invalid={Boolean(mobileError)}
                onChange={(e) => {
                  setMobile(e.target.value);
                  if (mobileError) setMobileError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
                placeholder="09121234567"
              />
            </FormField>
          ) : (
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
          )}

          <Button className="w-full" size="lg" disabled={pending} onClick={handleSubmit}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
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
