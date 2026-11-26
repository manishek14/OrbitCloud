"use client";

// Orbit core UI kit — small, composable building blocks shared by every area
// (public site, auth, portal, admin). All RTL-aware and theme-aware.

import { forwardRef, Fragment, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, RefreshCcw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { AnimatedNumber } from "./motion";
import { toFaDigits } from "@/lib/format/fa";

// ---------------------------------------------------------------------------
// Brand — the Orbit identity (geometric “A” mark, navy tile + electric bar).
// Single source of truth: the same geometry ships as public/brand/*.svg,
// src/app/icon.svg (favicon) and the Orchard theme assets. The wordmark stays
// as styled text (Vazirmatn everywhere) so it renders crisply at any size.
// ---------------------------------------------------------------------------

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-9 w-9", className)} aria-hidden="true">
      <rect width="48" height="48" rx="11" fill="#0B2447" />
      <path
        d="M13.5 34.5 24 13l10.5 21.5"
        fill="none"
        stroke="#F4F8FF"
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M18.2 26.6h11.6" fill="none" stroke="#3E9BFF" strokeWidth="4.4" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, textClassName }: { className?: string; textClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className={cn("flex flex-col leading-none", textClassName)}>
        <span className="text-lg font-extrabold tracking-tight ltr-iso" dir="ltr">
          Orb<span className="text-[#3E9BFF]">it</span>
        </span>
        <span className="text-[10px] font-medium text-muted-foreground">خدمات مدیریت‌شده IT</span>
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status badge — semantic, honest states everywhere
// ---------------------------------------------------------------------------

export type BadgeTone = "success" | "warning" | "danger" | "info" | "muted" | "primary";

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  info: "bg-info/10 text-info border-info/30",
  muted: "bg-muted text-muted-foreground border-border",
  primary: "bg-primary/10 text-primary border-primary/30",
};

const STATUS_MAP: Record<string, { tone: BadgeTone; label: string }> = {
  // orders
  pending_payment: { tone: "warning", label: "در انتظار پرداخت" },
  paid: { tone: "success", label: "پرداخت شده" },
  cancelled: { tone: "muted", label: "لغو شده" },
  // transactions
  pending: { tone: "warning", label: "در جریان" },
  succeeded: { tone: "success", label: "موفق" },
  failed: { tone: "danger", label: "ناموفق" },
  // tickets
  open: { tone: "info", label: "باز" },
  answered: { tone: "success", label: "پاسخ داده شده" },
  pending_customer: { tone: "warning", label: "در انتظار مشتری" },
  closed: { tone: "muted", label: "بسته شده" },
  // users / accounts
  active: { tone: "success", label: "فعال" },
  disabled: { tone: "danger", label: "غیرفعال" },
  // content
  published: { tone: "success", label: "منتشر شده" },
  draft: { tone: "muted", label: "پیش‌نویس" },
  // invoices
  issued: { tone: "info", label: "صادر شده" },
  void: { tone: "muted", label: "باطل شده" },
  // services / subscriptions / drive
  expired: { tone: "danger", label: "منقضی شده" },
  suspended: { tone: "warning", label: "معلق" },
  not_provisioned: { tone: "muted", label: "فعال نشده" },
  ready: { tone: "success", label: "متصل" },
  unreachable: { tone: "warning", label: "در دسترس نیست" },
  auth_failed: { tone: "danger", label: "خطای اعتبارنامه" },
  not_configured: { tone: "muted", label: "پیکربندی نشده" },
  missing_on_server: { tone: "danger", label: "یافت نشد در سرور" },
  // roles
  admin: { tone: "primary", label: "مدیر سیستم" },
  staff: { tone: "info", label: "کارشناس" },
  customer: { tone: "muted", label: "مشتری" },
  // ticket priorities
  low: { tone: "muted", label: "کم" },
  normal: { tone: "info", label: "عادی" },
  high: { tone: "warning", label: "بالا" },
  urgent: { tone: "danger", label: "فوری" },
  // ticket categories
  technical: { tone: "info", label: "فنی" },
  billing: { tone: "warning", label: "مالی" },
  sales: { tone: "primary", label: "فروش" },
  drive: { tone: "info", label: "Drive" },
  other: { tone: "muted", label: "سایر" },
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const entry = STATUS_MAP[status] ?? { tone: "muted" as BadgeTone, label: status };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        TONE_CLASSES[entry.tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {label ?? entry.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stat card (dashboards)
// ---------------------------------------------------------------------------

export function StatCard({
  icon,
  label,
  value,
  helper,
  animatedNumber,
  toman,
  tone = "primary",
  className,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  helper?: string;
  animatedNumber?: boolean;
  /** Render numeric value as a Toman amount. */
  toman?: boolean;
  tone?: "primary" | "success" | "warning" | "info" | "danger";
  className?: string;
}) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    info: "bg-info/10 text-info",
    danger: "bg-destructive/10 text-destructive",
  }[tone];
  const format = toman
    ? (v: number) => `${toFaDigits(v.toLocaleString("en-US"))} تومان`
    : (v: number) => toFaDigits(v.toLocaleString("en-US"));
  return (
    <div
      className={cn(
        "group rounded-xl border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 truncate text-2xl font-extrabold tabular-nums" dir="auto">
            {typeof value === "number" && animatedNumber ? (
              <AnimatedNumber value={value} format={format} />
            ) : typeof value === "number" ? (
              format(value)
            ) : (
              value
            )}
          </p>
          {helper ? <p className="mt-1 text-[11px] text-muted-foreground line-clamp-1">{helper}</p> : null}
        </div>
        <span className={cn("shrink-0 rounded-lg p-2.5", toneClass)}>{icon}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / error / loading states
// ---------------------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/40 px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? <span className="mb-4 rounded-full bg-muted p-3.5 text-muted-foreground">{icon}</span> : null}
      <h3 className="text-sm font-bold">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-xs leading-6 text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message = "خطایی رخ داد.",
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="mb-3 rounded-full bg-destructive/10 p-3 text-destructive">
        <AlertTriangle className="size-6" />
      </span>
      <h3 className="text-sm font-bold">{message}</h3>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-bold transition-colors hover:bg-accent"
        >
          <RefreshCcw className="size-3.5" />
          تلاش مجدد
        </button>
      ) : null}
    </div>
  );
}

export function SkeletonCards({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card p-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-4 h-7 w-28" />
          <Skeleton className="mt-3 h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function FullPageLoader({ label = "در حال بارگذاری…" }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
      <span className="relative flex size-10">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/25" />
        <span className="relative inline-flex size-10 items-center justify-center rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </span>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page header + breadcrumbs
// ---------------------------------------------------------------------------

export interface Crumb {
  label: string;
  to?: string;
}

export function PageBreadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              {index > 0 ? (
                <BreadcrumbSeparator>
                  <ChevronLeft className="size-3.5" />
                </BreadcrumbSeparator>
              ) : null}
              <BreadcrumbItem>
                {isLast || !item.to ? (
                  <BreadcrumbPage className="text-xs">{item.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={item.to} className="text-xs">
                      {item.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  className?: string;
}) {
  return (
    <div className={cn("mb-6 space-y-3", className)}>
      {breadcrumbs?.length ? <PageBreadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight md:text-2xl">{title}</h1>
          {description ? <p className="mt-1.5 max-w-2xl text-xs leading-6 text-muted-foreground md:text-sm">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search input
// ---------------------------------------------------------------------------

export const SearchInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { onClear?: () => void }
>(function SearchInput({ className, value, onClear, ...props }, ref) {
  return (
    <div className={cn("relative w-full", className)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        value={value}
        className="h-10 w-full rounded-lg border bg-background ps-9 pe-9 text-sm outline-none transition-all placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
        {...props}
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onClear?.();
          }}
          className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent"
          aria-label="پاک کردن جست‌وجو"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Price tag
// ---------------------------------------------------------------------------

export function PriceTag({
  toman,
  className,
  suffix = "تومان",
}: {
  toman: number | null | undefined;
  className?: string;
  suffix?: string;
}) {
  if (toman === null || toman === undefined) return <span className={className}>—</span>;
  return (
    <span className={cn("tabular-nums", className)} dir="auto">
      {toFaDigits(toman.toLocaleString("en-US"))} <span className="text-[0.75em] font-normal">{suffix}</span>
    </span>
  );
}
