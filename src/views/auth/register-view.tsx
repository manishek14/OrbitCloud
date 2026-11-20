"use client";

// ثبت‌نام — two-step flow in one view: (1) account details + terms,
// (2) mobile verification with OTP. Step transitions animate with
// AnimatePresence; form data is preserved when moving between steps.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Copy, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useRegister, useRequestOtp } from "@/lib/api/hooks";
import { errorMessage, ApiRequestError } from "@/lib/api/client";
import { toFaDigits } from "@/lib/format/fa";
import { normalizeMobileInput, validateRegisterProfile, type FieldErrors, type RegisterProfileForm } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField, TextField } from "@/components/abrit/form-field";
import { OTPInput, useCopyToClipboard, useCountdown } from "@/components/abrit/otp-input";

const OTP_DISPLAY_KEY = "abrit:otp-display";
const CODE_ERROR_CODES = new Set(["INVALID_CODE", "CODE_EXPIRED", "TOO_MANY_ATTEMPTS"]);
const TAKEN_ERROR_CODES = new Set(["EMAIL_TAKEN", "MOBILE_TAKEN"]);

interface RegisterFormState extends RegisterProfileForm {
  terms: boolean;
}

type RegisterFormErrors = FieldErrors;

export default function RegisterView() {
  const router = useRouter();
  const requestOtp = useRequestOtp();
  const register = useRegister();
  const countdown = useCountdown(120);
  const copyToClipboard = useCopyToClipboard();

  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<RegisterFormState>({
    name: "",
    email: "",
    mobile: "",
    password: "",
    passwordConfirm: "",
    terms: false,
  });
  const [errors, setErrors] = useState<RegisterFormErrors>({});
  const [otp, setOtp] = useState("");
  const [otpInvalid, setOtpInvalid] = useState(false);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [expirySeconds, setExpirySeconds] = useState(120);
  // Configured OTP code length (server-provided, audit §4.5).
  const [codeLength, setCodeLength] = useState(6);

  const normalizedMobile = () => normalizeMobileInput(form.mobile);

  // Entering step 2: restart the resend countdown. The demo display code is
  // captured from the OTP response itself (fresh value, same one stored in
  // sessionStorage) at the moment the step mounts.
  useEffect(() => {
    if (step !== 2) return;
    countdown.reset();
  }, [step]);

  const setField = <K extends keyof RegisterFormState>(field: K, value: RegisterFormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  // Single shared validation pass (same zod rules as the server) — errors
  // clear per-field as soon as the value becomes valid again.
  const validateStepOne = (): boolean => {
    const next = validateRegisterProfile(form);
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  /** Validates one field on blur (email/mobile/password) — early feedback. */
  const validateFieldOnBlur = (field: "name" | "email" | "mobile" | "password" | "passwordConfirm") => {
    const next = validateRegisterProfile(form);
    if (next[field]) setErrors((prev) => ({ ...prev, [field]: next[field] }));
  };

  const storeDisplayCode = (code: string, expiresInSeconds: number) => {
    try {
      sessionStorage.setItem(OTP_DISPLAY_KEY, JSON.stringify({ code, expiresInSeconds, at: Date.now() }));
    } catch {
      /* storage unavailable — the code was also shown via toast */
    }
  };

  const handleRequestOtp = () => {
    if (!validateStepOne()) return;
    const mobile = normalizedMobile();
    requestOtp.mutate(
      { mobile, purpose: "register" },
      {
        onSuccess: (result) => {
          if (result.delivery === "display" && result.code) {
            storeDisplayCode(result.code, result.expiresInSeconds);
            setDemoCode(result.code);
          } else {
            setDemoCode(null);
          }
          setExpirySeconds(result.expiresInSeconds);
          if (result.codeLength && result.codeLength >= 4 && result.codeLength <= 8) {
            setCodeLength(result.codeLength);
          }
          toast.success(result.message);
          setOtp("");
          setOtpInvalid(false);
          setStep(2);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  const handleResend = () => {
    const mobile = normalizedMobile();
    requestOtp.mutate(
      { mobile, purpose: "register" },
      {
        onSuccess: (result) => {
          if (result.delivery === "display" && result.code) {
            storeDisplayCode(result.code, result.expiresInSeconds);
            setDemoCode(result.code);
          }
          toast.success(result.message);
          setOtp("");
          setOtpInvalid(false);
          countdown.reset();
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  const handleVerify = (code: string) => {
    register.mutate(
      {
        name: form.name.trim(),
        email: form.email.trim(),
        mobile: normalizedMobile(),
        password: form.password,
        code,
      },
      {
        onSuccess: (result) => {
          toast.success(`خوش آمدید ${result.user.name ?? ""}! حساب شما ساخته شد.`);
          router.replace(routes.portal);
        },
        onError: (error) => {
          if (error instanceof ApiRequestError && error.fields) {
            // Server-side field validation (defense in depth — should already
            // have been caught before the OTP was requested). Surface the
            // message next to its field and return the user to step 1.
            const fieldErrors: RegisterFormErrors = {};
            for (const [key, message] of Object.entries(error.fields)) {
              if (key in form) fieldErrors[key as keyof RegisterFormErrors] = message;
            }
            if (Object.keys(fieldErrors).length > 0) {
              setErrors(fieldErrors);
              setOtp("");
              setOtpInvalid(false);
              setStep(1);
              toast.error("اطلاعات فرم نیاز به اصلاح دارد.");
              return;
            }
          }
          if (error instanceof ApiRequestError && TAKEN_ERROR_CODES.has(error.code)) {
            toast.error(error.message);
            setOtp("");
            setOtpInvalid(false);
            setStep(1);
            return;
          }
          if (error instanceof ApiRequestError && CODE_ERROR_CODES.has(error.code)) {
            setOtpInvalid(true);
            toast.error(error.message);
            // Clear after the shake feedback so the user can retype.
            window.setTimeout(() => {
              setOtp("");
              setOtpInvalid(false);
            }, 600);
            return;
          }
          toast.error(errorMessage(error));
        },
      },
    );
  };

  const goBackToForm = () => {
    setStep(1);
    setOtp("");
    setOtpInvalid(false);
  };

  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-xl font-extrabold md:text-2xl">ساخت حساب کاربری</h1>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          {step === 1
            ? "اطلاعات خود را وارد کنید؛ سپس شماره موبایل با کد یک‌بار مصرف تأیید می‌شود."
            : "کد ۶ رقمی پیامک‌شده به شماره موبایل خود را وارد کنید."}
        </p>
      </div>

      {/* Stepper */}
      <ol className="mb-8 flex items-center justify-center gap-2 text-[11px] font-bold" aria-label="مراحل ثبت‌نام">
        <li
          className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 transition-colors ${
            step === 1 ? "border-primary bg-primary/10 text-primary" : "border-success/40 bg-success/10 text-success"
          }`}
        >
          {step === 1 ? "۱" : "✓"} اطلاعات
        </li>
        <li className="h-px w-8 bg-border" aria-hidden="true" />
        <li
          className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 transition-colors ${
            step === 2 ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
          }`}
        >
          ۲ تأیید موبایل
        </li>
      </ol>

      <AnimatePresence mode="wait" initial={false}>
        {step === 1 ? (
          <motion.div
            key="register-step-1"
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <div className="space-y-4">
              <FormField label="نام و نام خانوادگی" htmlFor="register-name" required error={errors.name ?? null}>
                <TextField
                  id="register-name"
                  value={form.name}
                  invalid={Boolean(errors.name)}
                  onChange={(e) => setField("name", e.target.value)}
                  onBlur={() => validateFieldOnBlur("name")}
                  placeholder="مثال: سارا محمدی"
                />
              </FormField>

              <FormField label="ایمیل" htmlFor="register-email" required error={errors.email ?? null}>
                <TextField
                  id="register-email"
                  type="email"
                  inputMode="email"
                  dir="ltr"
                  value={form.email}
                  invalid={Boolean(errors.email)}
                  onChange={(e) => setField("email", e.target.value)}
                  // Immediate feedback on blur — an invalid email can never
                  // silently survive into the OTP step.
                  onBlur={() => validateFieldOnBlur("email")}
                  placeholder="you@company.ir"
                />
              </FormField>

              <FormField
                label="شماره موبایل"
                htmlFor="register-mobile"
                required
                error={errors.mobile ?? null}
                hint="کد تأیید ثبت‌نام به همین شماره ارسال می‌شود."
              >
                <TextField
                  id="register-mobile"
                  inputMode="tel"
                  dir="ltr"
                  className="text-center tracking-widest"
                  value={form.mobile}
                  invalid={Boolean(errors.mobile)}
                  onChange={(e) => setField("mobile", e.target.value)}
                  onBlur={() => validateFieldOnBlur("mobile")}
                  placeholder="09xxxxxxxxx"
                />
              </FormField>

              <FormField
                label="رمز عبور"
                htmlFor="register-password"
                required
                error={errors.password ?? null}
                hint="حداقل ۸ نویسه، شامل حداقل یک حرف و یک رقم."
              >
                <TextField
                  id="register-password"
                  type="password"
                  dir="ltr"
                  value={form.password}
                  invalid={Boolean(errors.password)}
                  onChange={(e) => setField("password", e.target.value)}
                  onBlur={() => validateFieldOnBlur("password")}
                />
              </FormField>

              <FormField
                label="تکرار رمز عبور"
                htmlFor="register-password-confirm"
                required
                error={errors.passwordConfirm ?? null}
              >
                <TextField
                  id="register-password-confirm"
                  type="password"
                  dir="ltr"
                  value={form.passwordConfirm}
                  invalid={Boolean(errors.passwordConfirm)}
                  onChange={(e) => setField("passwordConfirm", e.target.value)}
                  onBlur={() => validateFieldOnBlur("passwordConfirm")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRequestOtp();
                  }}
                />
              </FormField>

              <div>
                <label
                  htmlFor="register-terms"
                  className="flex cursor-pointer items-start gap-2.5 rounded-xl border bg-background p-3.5 text-xs leading-6 transition-colors hover:border-primary/40"
                >
                  <Checkbox
                    id="register-terms"
                    checked={form.terms}
                    onCheckedChange={(checked) => setField("terms", checked === true)}
                    className="mt-0.5"
                    aria-invalid={Boolean(errors.terms) || undefined}
                  />
                  <span className={errors.terms ? "text-destructive" : "text-foreground/90"}>
                    قوانین و شرایط استفاده از خدمات AbrIT را می‌پذیرم.
                  </span>
                </label>
                {errors.terms ? (
                  <p className="mt-1.5 text-[11px] font-medium text-destructive" role="alert">
                    {errors.terms}
                  </p>
                ) : null}
              </div>

              <Button className="w-full" size="lg" disabled={requestOtp.isPending} onClick={handleRequestOtp}>
                {requestOtp.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                دریافت کد تأیید
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="register-step-2"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
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

              <div className="rounded-xl border bg-muted/40 p-4 text-center">
                <p className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Smartphone className="size-3.5" />
                  کد به این شماره ارسال شد:
                </p>
                <p className="ltr-iso mt-1 text-sm font-extrabold tracking-widest" dir="ltr">
                  {normalizedMobile()}
                </p>
              </div>

              <div>
                <OTPInput
                  value={otp}
                  length={codeLength}
                  invalid={otpInvalid}
                  disabled={register.isPending}
                  onChange={(value) => {
                    setOtp(value);
                    if (otpInvalid) setOtpInvalid(false);
                  }}
                  onComplete={handleVerify}
                />
                <p className="mt-3 text-center text-[11px] text-muted-foreground">
                  کد{" "}
                  {expirySeconds % 60 === 0
                    ? `${toFaDigits(Math.round(expirySeconds / 60))} دقیقه`
                    : `${toFaDigits(expirySeconds)} ثانیه`}{" "}
                  اعتبار دارد و یک‌بار مصرف است.
                </p>
              </div>

              <div className="flex items-center justify-between gap-3">
                <Button type="button" variant="ghost" size="sm" onClick={goBackToForm} className="gap-1.5">
                  <ArrowRight className="size-3.5" />
                  ویرایش شماره
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={countdown.remaining > 0 || requestOtp.isPending}
                  onClick={handleResend}
                >
                  {requestOtp.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  {countdown.remaining > 0
                    ? `ارسال مجدد کد (${toFaDigits(countdown.remaining)} ثانیه)`
                    : "ارسال مجدد کد"}
                </Button>
              </div>

              {register.isPending ? (
                <p className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  در حال بررسی کد تأیید…
                </p>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-8 text-center text-[11px]">
        حساب دارید؟{" "}
        <Link to={routes.login} className="font-bold text-primary hover:text-primary/80">
          ورود
        </Link>
      </div>
    </div>
  );
}
