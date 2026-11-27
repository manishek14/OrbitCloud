"use client";

// پروفایل — identity card + editable name/company (PATCH /api/profile),
// read-only identity rows (email/mobile are support-managed) and account info.

import { useState } from "react";
import {
  CalendarDays,
  Lock,
  LogIn,
  Save,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { Link, useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useMe, useUpdateProfile } from "@/lib/api/hooks";
import { errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField, TextField } from "@/components/abrit/form-field";
import { PageHeader, StatusBadge, ErrorState } from "@/components/abrit/ui";
import { Reveal } from "@/components/abrit/motion";
import { formatDateTime } from "@/lib/format/fa";

const ROLE_LABEL: Record<string, string> = {
  admin: "مدیر سیستم",
  staff: "کارشناس",
  customer: "مشتری",
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 py-2.5 last:border-0">
      <span className="shrink-0 text-[11px] font-bold text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-xs font-medium">{value}</span>
    </div>
  );
}

export default function ProfileView() {
  const router = useRouter();
  const me = useMe();
  const updateProfile = useUpdateProfile();
  const user = me.data?.user ?? null;

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  // Prefill when the user data arrives — React's "adjust state on prop change"
  // pattern (render-time, no effect). Local edits are never overwritten because
  // the adjustment only runs when the user identity actually changes.
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  if (user && user.id !== prefilledFor) {
    setPrefilledFor(user.id);
    setName(user.name ?? "");
    setCompany(user.company ?? "");
  }

  if (me.isError) {
    return (
      <>
        <PageHeader
          title="پروفایل"
          breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "پروفایل" }]}
        />
        <ErrorState message="دریافت اطلاعات پروفایل انجام نشد." onRetry={() => me.refetch()} />
      </>
    );
  }

  if (!user) {
    return (
      <>
        <PageHeader
          title="پروفایل"
          breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "پروفایل" }]}
        />
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </>
    );
  }

  const handleSave = () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameError("نام و نام خانوادگی باید حداقل ۲ نویسه باشد.");
      return;
    }
    setNameError(null);
    updateProfile.mutate(
      { name: trimmed, company: company.trim() || undefined },
      {
        onSuccess: () => toast.success("پروفایل به‌روزرسانی شد"),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();

  return (
    <>
      <PageHeader
        title="پروفایل"
        description="اطلاعات حساب کاربری شما در پنل Orbit"
        breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "پروفایل" }]}
      />

      {/* Identity card */}
      <Reveal className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span
              className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-xl font-extrabold text-primary"
              aria-hidden="true"
            >
              {initials}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-extrabold">{user.name ?? "کاربر Orbit"}</h2>
              <p className="ltr-iso mt-1 truncate text-xs text-muted-foreground" dir="ltr">
                {user.email}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={user.role} />
                <StatusBadge status={user.status} />
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => router.navigate(routes.portalSecurity)}>
            <ShieldCheck className="size-3.5" />
            امنیت حساب
          </Button>
        </div>
      </Reveal>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Editable fields */}
        <Reveal delay={0.05} className="rounded-xl border bg-card p-5">
          <h3 className="flex items-center gap-2 text-sm font-extrabold">
            <UserIcon className="size-4 text-primary" />
            اطلاعات قابل ویرایش
          </h3>
          <div className="mt-4 space-y-4">
            <FormField
              label="نام و نام خانوادگی"
              htmlFor="profile-name"
              required
              error={nameError}
            >
              <TextField
                id="profile-name"
                value={name}
                invalid={Boolean(nameError)}
                disabled={updateProfile.isPending}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
              />
            </FormField>
            <FormField
              label="نام شرکت"
              htmlFor="profile-company"
              hint="اختیاری — روی فاکتورهای رسمی شما درج می‌شود."
            >
              <TextField
                id="profile-company"
                value={company}
                disabled={updateProfile.isPending}
                onChange={(e) => setCompany(e.target.value)}
              />
            </FormField>
            <Button
              className="w-full"
              onClick={handleSave}
              disabled={updateProfile.isPending}
            >
              {updateProfile.isPending ? <Save className="size-4 animate-pulse" /> : <Save className="size-4" />}
              ذخیره تغییرات
            </Button>
          </div>
        </Reveal>

        <div className="space-y-5">
          {/* Read-only identity */}
          <Reveal delay={0.1} className="rounded-xl border bg-card p-5">
            <h3 className="flex items-center gap-2 text-sm font-extrabold">
              <Lock className="size-4 text-muted-foreground" />
              اطلاعات قابل‌تغییر از طریق پشتیبانی
            </h3>
            <div className="mt-2">
              <InfoRow
                label="ایمیل"
                value={
                  <span className="flex items-center gap-2">
                    <span className="ltr-iso" dir="ltr">{user.email}</span>
                    <Lock className="size-3 shrink-0 text-muted-foreground/70" aria-label="قابل تغییر نیست" />
                  </span>
                }
              />
              <InfoRow
                label="شماره موبایل"
                value={
                  <span className="flex items-center gap-2">
                    <span className="ltr-iso" dir="ltr">{user.mobile ?? "—"}</span>
                    <Lock className="size-3 shrink-0 text-muted-foreground/70" aria-label="قابل تغییر نیست" />
                  </span>
                }
              />
            </div>
            <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-[10px] leading-5 text-muted-foreground">
              شماره موبایل شناسه ورود شماست؛ برای تغییر با پشتیبانی تماس بگیرید: {" "}
              <Link to={routes.portalTickets} className="font-bold text-primary hover:text-primary/80">
                ثبت تیکت پشتیبانی
              </Link>
            </p>
          </Reveal>

          {/* Account info */}
          <Reveal delay={0.15} className="rounded-xl border bg-card p-5">
            <h3 className="flex items-center gap-2 text-sm font-extrabold">
              <CalendarDays className="size-4 text-primary" />
              اطلاعات حساب
            </h3>
            <div className="mt-2">
              <InfoRow label="عضویت از" value={formatDateTime(user.createdAt)} />
              <InfoRow
                label="آخرین ورود"
                value={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "—"}
              />
              <InfoRow label="نقش" value={ROLE_LABEL[user.role] ?? user.role} />
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <LogIn className="size-3" />
              تاریخ آخرین ورود بر اساس نشست جاری شما به‌روزرسانی می‌شود.
            </p>
          </Reveal>
        </div>
      </div>
    </>
  );
}
