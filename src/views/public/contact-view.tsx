"use client";

// تماس با ما — sales/contact form (public endpoint) + real contact info from
// the public settings API. Support requests of existing customers are routed
// to the ticketing system in the customer portal.

import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Send,
  Smartphone,
  TicketCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useContactForm, usePublicSettings } from "@/lib/api/hooks";
import { errorMessage } from "@/lib/api/client";
import { toEnDigits } from "@/lib/format/fa";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/abrit/ui";
import { FormField, TextAreaField, TextField } from "@/components/abrit/form-field";
import { Reveal } from "@/components/abrit/motion";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^09\d{9}$/;

interface ContactFormState {
  name: string;
  email: string;
  mobile: string;
  subject: string;
  message: string;
}

const EMPTY_FORM: ContactFormState = { name: "", email: "", mobile: "", subject: "", message: "" };

export default function ContactView() {
  const router = useRouter();
  const settings = usePublicSettings();
  const contactForm = useContactForm();

  const [form, setForm] = useState<ContactFormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<ContactFormState>>({});
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  const contact = settings.data?.settings ?? {};
  const contactHours = contact.contact_hours;

  const setField = (field: keyof ContactFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = (): boolean => {
    const next: Partial<ContactFormState> = {};
    if (form.name.trim().length < 2) next.name = "نام و نام خانوادگی را وارد کنید (حداقل ۲ نویسه).";
    if (!EMAIL_RE.test(form.email.trim())) next.email = "ایمیل معتبر نیست؛ مثال: you@company.ir";
    const mobile = toEnDigits(form.mobile).replace(/[\s-]/g, "");
    if (mobile && !MOBILE_RE.test(mobile)) next.mobile = "شماره موبایل معتبر نیست (۰۹xxxxxxxxx).";
    if (!form.subject.trim()) next.subject = "موضوع پیام را وارد کنید.";
    if (form.message.trim().length < 10) next.message = "متن پیام باید حداقل ۱۰ نویسه باشد.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const mobile = toEnDigits(form.mobile).replace(/[\s-]/g, "");
    contactForm.mutate(
      {
        name: form.name.trim(),
        email: form.email.trim(),
        ...(mobile ? { mobile } : {}),
        subject: form.subject.trim(),
        message: form.message.trim(),
      },
      {
        onSuccess: (result) => {
          setSentMessage(result.message);
          toast.success(result.message);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  const infoRows = [
    { key: "contact_phone", icon: Phone, label: "تلفن ثابت", value: contact.contact_phone, ltr: true },
    { key: "contact_mobile", icon: Smartphone, label: "موبایل", value: contact.contact_mobile, ltr: true },
    { key: "contact_email", icon: Mail, label: "ایمیل", value: contact.contact_email, ltr: true },
    { key: "contact_address", icon: MapPin, label: "نشانی", value: contact.contact_address, ltr: false },
    { key: "contact_hours", icon: Clock, label: "ساعات کاری", value: contact.contact_hours, ltr: false },
  ].filter((row) => Boolean(row.value));

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 md:px-6 md:py-20">
      {/* ---------------------------------------------------------- Page head */}
      <Reveal>
        <div className="mb-10 text-center">
          <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">
            تماس با ما
          </span>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight md:text-3xl">
            گفت‌وگو با تیم Orbit
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            برای مشاوره انتخاب پکیج، سفارش‌های سازمانی یا سوالات فنی، پیام خود را ثبت کنید؛ کارشناسان ما در ساعات کاری پاسخ می‌دهند.
          </p>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ------------------------------------------------------ Form (main) */}
        <Reveal className="lg:col-span-2">
          <div className="rounded-2xl border bg-card p-6 md:p-8">
            {sentMessage !== null ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <span className="rounded-full bg-success/10 p-4 text-success">
                  <CheckCircle2 className="size-8" />
                </span>
                <h2 className="mt-5 text-base font-extrabold">پیام شما ثبت شد</h2>
                <p className="mt-2 max-w-md text-xs leading-6 text-muted-foreground">{sentMessage}</p>
                <Button
                  variant="outline"
                  className="mt-6"
                  onClick={() => {
                    setSentMessage(null);
                    setForm(EMPTY_FORM);
                    setErrors({});
                  }}
                >
                  ارسال پیام جدید
                </Button>
              </div>
            ) : (
              <>
                <h2 className="text-sm font-extrabold">فرم تماس</h2>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  فیلدهای ستاره‌دار الزامی هستند.
                </p>
                <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <FormField label="نام و نام خانوادگی" htmlFor="contact-name" required error={errors.name ?? null}>
                    <TextField
                      id="contact-name"
                      value={form.name}
                      invalid={Boolean(errors.name)}
                      onChange={(e) => setField("name", e.target.value)}
                      placeholder="مثال: سارا محمدی"
                    />
                  </FormField>
                  <FormField label="ایمیل" htmlFor="contact-email" required error={errors.email ?? null}>
                    <TextField
                      id="contact-email"
                      type="email"
                      dir="ltr"
                      inputMode="email"
                      value={form.email}
                      invalid={Boolean(errors.email)}
                      onChange={(e) => setField("email", e.target.value)}
                      placeholder="you@company.ir"
                    />
                  </FormField>
                  <FormField
                    label="شماره موبایل"
                    htmlFor="contact-mobile"
                    error={errors.mobile ?? null}
                    hint="اختیاری — برای پاسخ سریع‌تر تماسی."
                  >
                    <TextField
                      id="contact-mobile"
                      inputMode="tel"
                      dir="ltr"
                      className="text-start"
                      value={form.mobile}
                      invalid={Boolean(errors.mobile)}
                      onChange={(e) => setField("mobile", e.target.value)}
                      placeholder="09xxxxxxxxx"
                    />
                  </FormField>
                  <FormField label="موضوع" htmlFor="contact-subject" required error={errors.subject ?? null}>
                    <TextField
                      id="contact-subject"
                      value={form.subject}
                      invalid={Boolean(errors.subject)}
                      onChange={(e) => setField("subject", e.target.value)}
                      placeholder="مثال: مشاوره انتخاب پکیج"
                    />
                  </FormField>
                  <FormField
                    label="پیام"
                    htmlFor="contact-message"
                    required
                    error={errors.message ?? null}
                    className="sm:col-span-2"
                  >
                    <TextAreaField
                      id="contact-message"
                      value={form.message}
                      invalid={Boolean(errors.message)}
                      onChange={(e) => setField("message", e.target.value)}
                      placeholder="شرح درخواست یا سوال خود را بنویسید…"
                    />
                  </FormField>
                </div>
                <div className="mt-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Clock className="size-3.5" />
                    پاسخ‌گویی در ساعات کاری
                    {contactHours ? `: ${contactHours}` : ""}
                  </p>
                  <Button
                    size="lg"
                    className="gap-2"
                    disabled={contactForm.isPending}
                    onClick={handleSubmit}
                  >
                    {contactForm.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    ارسال پیام
                  </Button>
                </div>
              </>
            )}
          </div>
        </Reveal>

        {/* ---------------------------------------------------- Sidebar (info) */}
        <Reveal delay={0.08} className="space-y-6">
          <div className="rounded-2xl border bg-card p-6">
            <h2 className="text-sm font-extrabold">اطلاعات تماس</h2>
            {settings.isLoading ? (
              <div className="mt-5 space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="size-9 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-14" />
                      <Skeleton className="h-3.5 w-32" />
                    </div>
                  </div>
                ))}
              </div>
            ) : settings.isError ? (
              <div className="mt-4">
                <ErrorState message="بارگذاری اطلاعات تماس انجام نشد." onRetry={() => settings.refetch()} />
              </div>
            ) : infoRows.length === 0 ? (
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                اطلاعات تماس هنوز در پنل مدیریت ثبت نشده است.
              </p>
            ) : (
              <ul className="mt-5 space-y-4">
                {infoRows.map((row) => (
                  <li key={row.key} className="flex items-center gap-3">
                    <span className="shrink-0 rounded-lg bg-primary/10 p-2 text-primary">
                      <row.icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium text-muted-foreground">{row.label}</p>
                      {row.ltr ? (
                        <p className="ltr-iso mt-0.5 truncate text-xs font-bold" dir="ltr">
                          {row.value}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs font-bold leading-5">{row.value}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
            <span className="inline-flex rounded-lg bg-primary/10 p-2.5 text-primary">
              <TicketCheck className="size-5" />
            </span>
            <h2 className="mt-3.5 text-sm font-extrabold">مشتری Orbit هستید؟</h2>
            <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
              درخواست‌های پشتیبانی را از پنل مشتری به‌صورت تیکت ثبت کنید تا با اولویت مطابق SLA پکیج شما پیگیری شوند.
            </p>
            <Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => router.navigate(routes.portalTickets)}>
              ورود به پنل و ثبت تیکت
            </Button>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
