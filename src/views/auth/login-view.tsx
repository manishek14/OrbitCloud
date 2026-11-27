"use client";

// Login — mobile number + OTP is the primary authentication method;
// email/password remains available as a separate alternative tab.

import { useState } from "react";
import { KeyRound, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useLoginPassword, useRequestOtp } from "@/lib/api/hooks";
import { errorMessage } from "@/lib/api/client";
import { looksLikeEmail, normalizeIdentifierDigits, isValidMobile } from "@/lib/auth/identifier";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { FormField, TextField } from "@/components/abrit/form-field";
import { toEnDigits } from "@/lib/format/fa";

export default function LoginView() {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [mobileError, setMobileError] = useState<string | null>(null);

  const [identifier, setIdentifier] = useState("");
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  const requestOtp = useRequestOtp();
  const loginPassword = useLoginPassword();

  const validateMobile = (value: string): boolean => {
    const normalized = toEnDigits(value).replace(/[\s-]/g, "");
    if (!/^09\d{9}$/.test(normalized)) {
      setMobileError("شماره همراه باید با ۰۹ شروع شود و ۱۱ رقم باشد.");
      return false;
    }
    setMobileError(null);
    return true;
  };

  const handleRequestOtp = () => {
    const normalized = toEnDigits(mobile).replace(/[\s-]/g, "");
    if (!validateMobile(normalized)) return;
    requestOtp.mutate(
      { mobile: normalized, purpose: "login" },
      {
        onSuccess: (result) => {
          // Sandbox display mode: hand the code to the verify page via
          // sessionStorage (clearly labeled there as demo delivery).
          if (result.delivery === "display" && result.code) {
            try {
              sessionStorage.setItem(
                "orbit:otp-display",
                JSON.stringify({ code: result.code, expiresInSeconds: result.expiresInSeconds, at: Date.now() }),
              );
            } catch {
              /* storage unavailable — the code was also shown via toast */
            }
          }
          toast.success(result.message);
          router.navigate(
            `${routes.verifyOtp}?mobile=${encodeURIComponent(normalized)}&purpose=login&expires=${result.expiresInSeconds}&len=${result.codeLength ?? 6}`,
          );
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  // The password field accepts EITHER an email or a mobile number — the same
  // parse/normalize rules as the server (src/lib/auth/identifier.ts).
  const validateIdentifier = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) {
      setIdentifierError("شماره تماس یا ایمیل را وارد کنید.");
      return false;
    }
    if (trimmed.includes("@")) {
      if (!looksLikeEmail(trimmed)) {
        setIdentifierError("ایمیل معتبر نیست؛ مثال: you@company.ir");
        return false;
      }
    } else if (!isValidMobile(normalizeIdentifierDigits(trimmed))) {
      setIdentifierError("شماره همراه باید با ۰۹ شروع شود و ۱۱ رقم باشد.");
      return false;
    }
    setIdentifierError(null);
    return true;
  };

  const handlePasswordLogin = () => {
    if (!validateIdentifier(identifier) || !password) {
      if (password) toast.error("رمز عبور را وارد کنید.");
      return;
    }
    loginPassword.mutate(
      { identifier: identifier.trim(), password },
      {
        onSuccess: (result) => {
          toast.success(`خوش آمدید ${result.user.name ?? ""}!`);
          // `next` may only be a SAFE relative reference (rebrand review §4,
          // P2): startsWith("/") alone admits network-path references like
          // "//evil.com" and "/\\evil.com", which leave the origin entirely.
          // Same rule as the CMS proxy Location sanitizer (FSR-6, rule 1).
          const next = router.query.next;
          router.replace(next && /^\/(?!\/|\\)/.test(next) ? next : result.redirect);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  return (
    <div>
      <div className="mb-8 text-center">
        <h1 className="text-xl font-extrabold md:text-2xl">ورود به حساب کاربری</h1>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          با شماره موبایل و کد یک‌بار مصرف وارد شوید؛ یا از تب رمز عبور استفاده کنید.
        </p>
      </div>

      {/* Sandbox demo credentials — transparent labeling */}
      <div className="mb-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[11px] leading-6 text-warning">
        <p className="font-bold">محیط نمایشی</p>
        <p>
          مشتری نمونه: <span className="ltr-iso font-bold" dir="ltr">demo@abrit.ir / AbrIT@Demo1405</span>
          <br />
          مدیر سیستم: <span className="ltr-iso font-bold" dir="ltr">admin@abrit.ir / AbrIT@Admin1405</span>
          <br />
          شماره موبایل حساب نمونه: <span className="ltr-iso font-bold" dir="ltr">09121111111</span> و مدیر: <span className="ltr-iso font-bold" dir="ltr">09120000000</span>
        </p>
      </div>

      <Tabs defaultValue="mobile" dir="rtl">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="mobile" className="gap-1.5 text-xs">
            <Smartphone className="size-3.5" />
            ورود با موبایل
          </TabsTrigger>
          <TabsTrigger value="password" className="gap-1.5 text-xs">
            <KeyRound className="size-3.5" />
            ورود با رمز عبور
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mobile" className="mt-6 space-y-4">
          <FormField
            label="شماره موبایل"
            htmlFor="login-mobile"
            required
            error={mobileError}
            hint="مثال: ۰۹۱۲۱۱۱۱۱۱۱ — کد تأیید برای همین شماره ارسال می‌شود."
          >
            <TextField
              id="login-mobile"
              inputMode="tel"
              placeholder="09xxxxxxxxx"
              dir="ltr"
              className="text-center tracking-widest"
              value={mobile}
              invalid={Boolean(mobileError)}
              onChange={(e) => {
                setMobile(e.target.value);
                if (mobileError) setMobileError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRequestOtp();
              }}
            />
          </FormField>
          <Button
            className="w-full"
            size="lg"
            disabled={requestOtp.isPending}
            onClick={handleRequestOtp}
          >
            {requestOtp.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            دریافت کد تأیید
          </Button>
        </TabsContent>

        <TabsContent value="password" className="mt-6 space-y-4">
          <FormField
            label="شماره تماس یا ایمیل"
            htmlFor="login-identifier"
            required
            error={identifierError}
            hint="ورود با ایمیل یا شماره همراه، همراه با رمز عبور."
          >
            <TextField
              id="login-identifier"
              type="text"
              inputMode="email"
              autoComplete="username"
              dir="ltr"
              placeholder="you@company.ir | 09xxxxxxxxx"
              value={identifier}
              invalid={Boolean(identifierError)}
              onChange={(e) => {
                setIdentifier(e.target.value);
                if (identifierError) setIdentifierError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePasswordLogin();
              }}
            />
          </FormField>
          <FormField label="رمز عبور" htmlFor="login-password" required>
            <TextField
              id="login-password"
              type="password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePasswordLogin();
              }}
            />
          </FormField>
          <Button
            className="w-full"
            size="lg"
            disabled={loginPassword.isPending}
            onClick={handlePasswordLogin}
          >
            {loginPassword.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            ورود
          </Button>
        </TabsContent>
      </Tabs>

      <div className="mt-6 flex items-center justify-between text-[11px]">
        <Link
          to={routes.forgotPassword}
          className="font-bold text-primary hover:text-primary/80"
        >
          رمز عبور را فراموش کرده‌اید؟
        </Link>
        <Link to={routes.register} className="font-bold text-primary hover:text-primary/80">
          ساخت حساب جدید
        </Link>
      </div>
    </div>
  );
}
