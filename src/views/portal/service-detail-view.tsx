"use client";

// جزئیات سرویس — one ServiceDTO with its linked subscription (when present),
// metadata fields, drive cross-link and an honest lifecycle timeline.

import {
  ArrowRight,
  CalendarClock,
  CircleCheck,
  CircleDashed,
  Cloud,
  Package,
  Users,
} from "lucide-react";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useService, useSubscriptions } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import {
  PageHeader,
  StatusBadge,
  ErrorState,
  PriceTag,
} from "@/components/abrit/ui";
import { Reveal } from "@/components/abrit/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatDateTime, toFaDigits } from "@/lib/format/fa";

const SERVICE_TYPE_LABEL: Record<string, string> = {
  managed_it: "IT مدیریت‌شده",
  drive: "فضای ابری AbrIT Drive",
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 py-2.5 last:border-0">
      <span className="shrink-0 text-[11px] font-bold text-muted-foreground">{label}</span>
      <span className="min-w-0 text-xs font-medium">{value}</span>
    </div>
  );
}

export default function PortalServiceDetailView({ id }: { id: string }) {
  const router = useRouter();
  const service = useService(id);
  const subscriptions = useSubscriptions();

  const data = service.data;

  if (service.isError) {
    return (
      <>
        <PageHeader
          title="جزئیات سرویس"
          breadcrumbs={[
            { label: "پنل کاربری", to: routes.portal },
            { label: "سرویس‌های من", to: routes.portalServices },
            { label: "جزئیات سرویس" },
          ]}
        />
        <ErrorState
          message="سرویس موردنظر یافت نشد یا دسترسی به آن ممکن نیست."
          onRetry={() => service.refetch()}
        />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => router.navigate(routes.portalServices)}>
            <ArrowRight className="size-3.5" />
            بازگشت به سرویس‌ها
          </Button>
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader
          title="جزئیات سرویس"
          breadcrumbs={[
            { label: "پنل کاربری", to: routes.portal },
            { label: "سرویس‌های من", to: routes.portalServices },
            { label: "در حال بارگذاری…" },
          ]}
        />
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-52 w-full rounded-xl" />
            <Skeleton className="h-52 w-full rounded-xl" />
          </div>
        </div>
      </>
    );
  }

  const meta = data.metadata ?? {};
  const isDrive = data.type === "drive";
  const isExpired = data.expiresAt ? new Date(data.expiresAt).getTime() < Date.now() : false;
  const sub = data.subscriptionId
    ? (subscriptions.data ?? []).find((s) => s.id === data.subscriptionId) ?? null
    : null;
  const subExpired = sub ? new Date(sub.expiresAt).getTime() < Date.now() : false;

  const Icon = isDrive ? Cloud : Package;

  return (
    <>
      <PageHeader
        title={data.title}
        description="مشخصات، وضعیت و چرخه زندگی این سرویس"
        breadcrumbs={[
          { label: "پنل کاربری", to: routes.portal },
          { label: "سرویس‌های من", to: routes.portalServices },
          { label: data.title },
        ]}
        actions={<StatusBadge status={isExpired && data.status === "active" ? "expired" : data.status} />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Basic info card */}
        <Reveal className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-3 border-b pb-4">
            <span
              className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
                isDrive ? "bg-info/10 text-info" : "bg-primary/10 text-primary"
              }`}
              aria-hidden="true"
            >
              <Icon className="size-5.5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-extrabold">{data.title}</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {SERVICE_TYPE_LABEL[data.type] ?? data.type}
              </p>
            </div>
          </div>
          <div className="mt-2">
            <InfoRow
              label="وضعیت"
              value={<StatusBadge status={isExpired && data.status === "active" ? "expired" : data.status} />}
            />
            <InfoRow label="نوع سرویس" value={SERVICE_TYPE_LABEL[data.type] ?? data.type} />
            <InfoRow label="تاریخ فعال‌سازی" value={formatDateTime(data.activatedAt)} />
            <InfoRow
              label="تاریخ انقضا"
              value={
                <span className={isExpired ? "font-bold text-destructive" : undefined}>
                  {formatDateTime(data.expiresAt)}
                </span>
              }
            />
            {meta.packageNameFa ? <InfoRow label="پکیج" value={String(meta.packageNameFa)} /> : null}
            {meta.planCode ? <InfoRow label="پلن Drive" value={<span className="ltr-iso" dir="ltr">{String(meta.planCode)}</span>} /> : null}
            {meta.quotaLabel ? (
              <InfoRow
                label="سهمیه فضای ابری"
                value={
                  /^\d+$/.test(String(meta.quotaLabel))
                    ? formatBytes(Number(meta.quotaLabel))
                    : String(meta.quotaLabel)
                }
              />
            ) : null}
            {typeof meta.users === "number" ? (
              <InfoRow label="کاربران" value={`${toFaDigits(meta.users)} کاربر`} />
            ) : null}
            {typeof meta.endpoints === "number" ? (
              <InfoRow label="Endpointها" value={`${toFaDigits(meta.endpoints)} دستگاه`} />
            ) : null}
            <InfoRow label="تاریخ ثبت" value={formatDateTime(data.createdAt)} />
          </div>
        </Reveal>

        <div className="space-y-5">
          {/* Drive cross-link */}
          {isDrive ? (
            <Reveal delay={0.05} className="rounded-xl border border-info/30 bg-info/5 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 text-sm font-extrabold">
                    <Cloud className="size-4 text-info" />
                    فضای ابری AbrIT Drive
                  </h3>
                  <p className="mt-2 text-xs leading-6 text-muted-foreground">
                    مصرف فضا، ورود به Drive، تغییر سهمیه و رویدادهای حساب از صفحه اختصاصی
                    AbrIT Drive مدیریت می‌شود.
                  </p>
                  {meta.ncUsername ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      نام کاربری Drive:{" "}
                      <span className="ltr-iso rounded bg-muted px-1.5 py-0.5 font-bold" dir="ltr">
                        {String(meta.ncUsername)}
                      </span>
                    </p>
                  ) : null}
                </div>
                <Button size="sm" className="shrink-0" onClick={() => router.navigate(routes.portalDrive)}>
                  <Cloud className="size-3.5" />
                  مدیریت از صفحه AbrIT Drive
                </Button>
              </div>
            </Reveal>
          ) : null}

          {/* Linked subscription */}
          {data.subscriptionId ? (
            subscriptions.isLoading ? (
              <Reveal delay={0.08} className="rounded-xl border bg-card p-5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-4 h-40 w-full" />
              </Reveal>
            ) : sub ? (
              <Reveal delay={0.08} className="rounded-xl border bg-card p-5">
                <h3 className="flex items-center gap-2 text-sm font-extrabold">
                  <Users className="size-4 text-primary" />
                  اشتراک مرتبط
                </h3>
                <div className="mt-2">
                  <InfoRow label="پکیج" value={sub.packageNameFa} />
                  <InfoRow label="مدت قرارداد" value={`${toFaDigits(sub.months)} ماه`} />
                  <InfoRow
                    label="کاربران / Endpointها"
                    value={`${toFaDigits(sub.users)} کاربر / ${toFaDigits(sub.endpoints)} Endpoint`}
                  />
                  <InfoRow label="شروع" value={formatDateTime(sub.startsAt)} />
                  <InfoRow label="پایان" value={formatDateTime(sub.expiresAt)} />
                  <InfoRow
                    label="مبلغ کل"
                    value={<PriceTag toman={sub.priceTotalToman} className="text-xs" />}
                  />
                  <InfoRow
                    label="وضعیت اشتراک"
                    value={<StatusBadge status={subExpired && sub.status === "active" ? "expired" : sub.status} />}
                  />
                </div>
              </Reveal>
            ) : (
              <Reveal delay={0.08} className="rounded-xl border border-dashed bg-card/40 p-5 text-center">
                <p className="text-xs text-muted-foreground">
                  اطلاعات اشتراک مرتبط با این سرویس در حال حاضر قابل دریافت نیست.
                </p>
              </Reveal>
            )
          ) : null}

          {/* Lifecycle timeline */}
          <Reveal delay={0.12} className="rounded-xl border bg-card p-5">
            <h3 className="flex items-center gap-2 text-sm font-extrabold">
              <CalendarClock className="size-4 text-primary" />
              چرخه زندگی سرویس
            </h3>
            <ol className="mt-4 space-y-0">
              {[
                {
                  label: "ثبت سرویس",
                  at: formatDateTime(data.createdAt),
                  done: true,
                },
                {
                  label: "فعال‌سازی",
                  at: formatDateTime(data.activatedAt),
                  done: Boolean(data.activatedAt),
                },
                {
                  label: "انقضا",
                  at: formatDateTime(data.expiresAt),
                  done: isExpired,
                },
              ].map((step, index, arr) => (
                <li key={step.label} className="relative flex gap-3 pb-5 last:pb-0">
                  {index < arr.length - 1 ? (
                    <span
                      className="absolute start-[9px] top-5 h-full w-px bg-border"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="relative z-10 mt-0.5 shrink-0" aria-hidden="true">
                    {step.done ? (
                      <CircleCheck className="size-[19px] text-success" />
                    ) : (
                      <CircleDashed className="size-[19px] text-muted-foreground/60" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-xs font-bold ${step.done ? "" : "text-muted-foreground"}`}>
                      {step.label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{step.at}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </div>

      <div className="mt-6">
        <Button variant="outline" size="sm" onClick={() => router.navigate(routes.portalServices)}>
          <ArrowRight className="size-3.5" />
          بازگشت به سرویس‌ها
        </Button>
      </div>
    </>
  );
}
