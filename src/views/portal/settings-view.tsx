"use client";

// تنظیمات — appearance (next-themes), honest notification preferences
// (in-panel only in this version), locale info and account quick links.

import { useTheme } from "next-themes";
import {
  Bell,
  CalendarDays,
  Check,
  Globe,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  User as UserIcon,
} from "lucide-react";
import { Link } from "@/lib/router";
import { routes } from "@/lib/routes";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/abrit/ui";
import { Reveal } from "@/components/abrit/motion";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Card 1: theme
// ---------------------------------------------------------------------------

const THEME_OPTIONS = [
  { value: "dark", label: "تاریک", description: "پوسته پیش‌فرض سازمانی", icon: Moon },
  { value: "light", label: "روشن", description: "مناسب محیط‌های پرنور", icon: Sun },
  { value: "system", label: "سیستم", description: "پیروی از تنظیمات دستگاه", icon: Monitor },
] as const;

function ThemeCard() {
  const { theme, setTheme } = useTheme();

  // During SSR and the first client render next-themes reports `undefined`;
  // both render the dark default so there is no hydration mismatch. Once the
  // stored preference is read, the active card updates.
  const current = theme ?? "dark";

  return (
    <Reveal className="rounded-xl border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-extrabold">
        <Palette className="size-4 text-primary" />
        پوسته نمایش
      </h2>
      <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
        ظاهر پنل کاربری را انتخاب کنید؛ انتخاب شما روی همین مرورگر ذخیره می‌شود.
      </p>
      <div role="radiogroup" aria-label="پوسته نمایش" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {THEME_OPTIONS.map((option) => {
          const selected = current === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(option.value)}
              className={cn(
                "flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-xl border p-4 text-center transition-all",
                selected
                  ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                  : "border-border hover:border-primary/40 hover:bg-accent",
              )}
            >
              <option.icon className={cn("size-5", selected ? "text-primary" : "text-muted-foreground")} />
              <span className={cn("text-xs font-extrabold", selected && "text-primary")}>{option.label}</span>
              <span className="text-[10px] leading-4 text-muted-foreground">{option.description}</span>
              {selected ? (
                <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
                  <Check className="size-3" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </Reveal>
  );
}

// ---------------------------------------------------------------------------
// Card 2: notifications (honest: in-panel only)
// ---------------------------------------------------------------------------

function NotificationsCard() {
  return (
    <Reveal delay={0.05} className="rounded-xl border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-extrabold">
        <Bell className="size-4 text-primary" />
        اعلان‌ها
      </h2>
      <div className="mt-3 rounded-xl border border-info/25 bg-info/5 px-4 py-3 text-[11px] leading-6 text-info">
        اعلان‌های شما به‌صورت درون‌پنلی نمایش داده می‌شوند. ارسال اعلان ایمیلی/پیامکی در این نسخه فعال نیست.
      </div>
      <ul className="mt-4 space-y-3">
        {[
          { label: "اعلان‌های سفارش و پرداخت", hint: "رویدادهای سفارش، فاکتور و تراکنش" },
          { label: "اعلان‌های Orbit Drive", hint: "تغییر سهمیه، وضعیت حساب و رویدادها" },
          { label: "اعلان‌های تیکت و پشتیبانی", hint: "پاسخ کارشناسان و تغییر وضعیت تیکت" },
        ].map((item) => (
          <li
            key={item.label}
            className="flex items-center justify-between gap-3 rounded-xl border border-dashed bg-background/40 p-3.5 opacity-70"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-xs font-bold">
                {item.label}
                <Badge variant="secondary" className="text-[9px] font-bold">
                  به‌زودی
                </Badge>
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{item.hint}</p>
            </div>
            <Switch checked={false} disabled aria-label={`${item.label} (به‌زودی)`} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
        کانال‌های ایمیلی و پیامکی در نسخه‌های بعدی در دسترس قرار می‌گیرند؛ اعلان‌های درون‌پنلی همیشه فعال هستند.
      </p>
    </Reveal>
  );
}

// ---------------------------------------------------------------------------
// Card 3: language & region
// ---------------------------------------------------------------------------

function LocaleCard() {
  return (
    <Reveal delay={0.1} className="rounded-xl border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-extrabold">
        <Globe className="size-4 text-primary" />
        زبان و منطقه
      </h2>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border bg-background/40 p-3.5">
        <div>
          <p className="text-xs font-bold">فارسی ( ایران)</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">زبان رابط کاربری پنل</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-bold text-success">
          <Check className="size-3" />
          فعال
        </span>
      </div>
      <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-muted/60 px-3 py-2 text-[10px] leading-5 text-muted-foreground">
        <CalendarDays className="mt-0.5 size-3 shrink-0" />
        تاریخ‌ها بر پایه تقویم شمسی نمایش داده می‌شوند.
      </p>
    </Reveal>
  );
}

// ---------------------------------------------------------------------------
// Card 4: account quick links
// ---------------------------------------------------------------------------

function AccountCard() {
  return (
    <Reveal delay={0.15} className="rounded-xl border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-extrabold">
        <UserIcon className="size-4 text-primary" />
        حساب کاربری
      </h2>
      <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
        مدیریت اطلاعات شخصی و امنیت حساب از صفحات اختصاصی انجام می‌شود.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          to={routes.portalProfile}
          className="flex min-h-11 items-center justify-between gap-3 rounded-xl border bg-background/40 p-3.5 transition-all hover:border-primary/40 hover:shadow-sm"
        >
          <span className="flex items-center gap-2.5 text-xs font-bold">
            <UserIcon className="size-4 text-primary" />
            پروفایل و اطلاعات شخصی
          </span>
        </Link>
        <Link
          to={routes.portalSecurity}
          className="flex min-h-11 items-center justify-between gap-3 rounded-xl border bg-background/40 p-3.5 transition-all hover:border-primary/40 hover:shadow-sm"
        >
          <span className="flex items-center gap-2.5 text-xs font-bold">
            <ShieldCheck className="size-4 text-primary" />
            امنیت، رمز عبور و نشست‌ها
          </span>
        </Link>
      </div>
    </Reveal>
  );
}

export default function PortalSettingsView() {
  return (
    <>
      <PageHeader
        title="تنظیمات"
        description="شخصی‌سازی نمایش، اعلان‌ها و اطلاعات حساب شما"
        breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "تنظیمات" }]}
      />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <ThemeCard />
        <NotificationsCard />
        <LocaleCard />
        <AccountCard />
      </div>
    </>
  );
}
