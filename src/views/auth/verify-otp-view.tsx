"use client";

// تأیید ورود — verifies the login OTP for the mobile passed via query params
// (set by the login view). Redirects back to login when no mobile is present.

import { useEffect, useState } from "react";
import { ArrowRight, Copy, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useRequestOtp, useVerifyOtpLogin } from "@/lib/api/hooks";
import { errorMessage } from "@/lib/api/client";
import { toEnDigits, toFaDigits } from "@/lib/format/fa";
import { Button } from "@/components/ui/button";
import { OTPInput, useCopyToClipboard, useCountdown } from "@/components/abrit/otp-input";

const OTP_DISPLAY_KEY = "abrit:otp-display";

/** 09121111111 → ۰۹۱۲***۱۱۱۱ (middle 3 digits masked). */
function maskMobile(mobile: string): string {
  if (mobile.length < 8) return toFaDigits(mobile);
  return toFaDigits(mobile.slice(0, 4) + "***" + mobile.slice(7));
}

/** Reads the sandbox display code from sessionStorage (no-op on servers /
 *  stale entries). This view only renders client-side after hydration. */
function readDisplayCode(): string | null {
  try {
    const raw = sessionStorage.getItem(OTP_DISPLAY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { code?: string; at?: number };
      if (parsed.code && Date.now() - (parsed.at ?? 0) < 5 * 60_000) {
        return parsed.code;
      }
    }
  } catch {
    /* storage unavailable — banner simply stays hidden */
  }
  return null;
}

export default function VerifyOtpView() {
  const router = useRouter();
  const verifyOtp = useVerifyOtpLogin();
  const requestOtp = useRequestOtp();
  const countdown = useCountdown(120);
  const copyToClipboard = useCopyToClipboard();

  const rawMobile = router.query.mobile ?? "";
  const mobile = toEnDigits(rawMobile).replace(/[\s-]/g, "");
  const next = router.query.next;
  // Expiry from the OTP request (server-configured, falls back to 120s).
  const expiresSeconds = (() => {
    const parsed = Number(router.query.expires);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 120;
  })();
  const expiryLabel =
    expiresSeconds % 60 === 0
      ? `${toFaDigits(Math.round(expiresSeconds / 60))} دقیقه`
      : `${toFaDigits(expiresSeconds)} ثانیه`;

  const [otp, setOtp] = useState("");
  const [otpInvalid, setOtpInvalid] = useState(false);
  // Sandbox display code — read exactly once, on mount (lazy initializer).
  const [demoCode, setDemoCode] = useState<string | null>(() => readDisplayCode());

  // No mobile → back to login.
  useEffect(() => {
    if (!mobile) router.replace(routes.login);
  }, [mobile, router]);

  // Start the resend countdown on mount.
  useEffect(() => {
    countdown.reset();
  }, []);

  const handleVerify = (code: string) => {
    verifyOtp.mutate(
      { mobile, code },
      {
        onSuccess: (result) => {
          toast.success(`خوش آمدید ${result.user.name ?? ""}!`);
          router.replace(next && next.startsWith("/") ? next : result.redirect);
        },
        onError: (error) => {
          setOtpInvalid(true);
          toast.error(errorMessage(error));
          window.setTimeout(() => {
            setOtp("");
            setOtpInvalid(false);
          }, 600);
        },
      },
    );
  };

  const handleResend = () => {
    requestOtp.mutate(
      { mobile, purpose: "login" },
      {
        onSuccess: (result) => {
          if (result.delivery === "display" && result.code) {
            try {
              sessionStorage.setItem(
                OTP_DISPLAY_KEY,
                JSON.stringify({ code: result.code, expiresInSeconds: result.expiresInSeconds, at: Date.now() }),
              );
            } catch {
              /* storage unavailable */
            }
            setDemoCode(result.code);
          }
          toast.success(result.message);
          setOtp("");
          setOtpInvalid(false);
          countdown.reset();
        },
        // RATE_LIMITED messages already include the wait guidance from the API.
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  if (!mobile) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          در حال انتقال به صفحه ورود…
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-xl font-extrabold md:text-2xl">تأیید ورود</h1>
        <p className="mt-2 flex flex-wrap items-center justify-center gap-1 text-xs leading-6 text-muted-foreground">
          <Smartphone className="size-3.5" />
          کد ۶ رقمی ارسال‌شده به
          <span className="ltr-iso font-extrabold tracking-widest" dir="ltr">
            {maskMobile(mobile)}
          </span>
          را وارد کنید.
        </p>
      </div>

      <div className="space-y-5">
        {/* Sandbox display-mode banner */}
        {demoCode ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[11px] font-bold text-warning">
            <p className="leading-6">
              محیط نمایشی: کد تأیید شما <span className="ltr-iso tracking-widest" dir="ltr">{demoCode}</span> است
            </p>
            <button
              type="button"
              onClick={() => copyToClipboard(demoCode, "کد تأیید کپی شد.")}
              className="shrink-0 rounded-lg border border-warning/40 p-1.5 transition-colors hover:bg-warning/20"
              aria-label="کپی کد تأیید"
            >
              <Copy className="size-3.5" />
            </button>
          </div>
        ) : null}

        <div>
          <OTPInput
            value={otp}
            invalid={otpInvalid}
            disabled={verifyOtp.isPending}
            onChange={(value) => {
              setOtp(value);
              if (otpInvalid) setOtpInvalid(false);
            }}
            onComplete={handleVerify}
          />
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            کد {expiryLabel} اعتبار دارد و یک‌بار مصرف است.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => router.replace(routes.login)} className="gap-1.5">
            <ArrowRight className="size-3.5" />
            تغییر شماره
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={countdown.remaining > 0 || requestOtp.isPending}
            onClick={handleResend}
          >
            {requestOtp.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {countdown.remaining > 0
              ? `ارسال مجدد کد (${toFaDigits(countdown.remaining)} ثانیه)`
              : "ارسال مجدد کد"}
          </Button>
        </div>

        {verifyOtp.isPending ? (
          <p className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            در حال بررسی کد تأیید…
          </p>
        ) : null}
      </div>
    </div>
  );
}
