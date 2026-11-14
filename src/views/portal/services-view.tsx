"use client";

// سرویس‌های من — all services of the signed-in customer with a subscription
// summary. Every card is a real ServiceDTO from /api/services; clicking a card
// opens the service detail page.

import { Boxes, Clock, Cloud, Package, Plus } from "lucide-react";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useServices, useSubscriptions } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import {
  PageHeader,
  StatCard,
  StatusBadge,
  EmptyState,
  ErrorState,
  SkeletonCards,
} from "@/components/abrit/ui";
import { Stagger, StaggerItem } from "@/components/abrit/motion";
import { Reveal } from "@/components/abrit/motion";
import { formatBytes, formatDateTime, toFaDigits } from "@/lib/format/fa";
import type { ServiceDTO } from "@/lib/api/types";

const SERVICE_TYPE_LABEL: Record<ServiceDTO["type"], string> = {
  managed_it: "IT مدیریت‌شده",
  drive: "فضای ابری AbrIT Drive",
};

/** Compact per-type metadata summary rendered under each card title. */
function ServiceMeta({ service }: { service: ServiceDTO }) {
  const meta = service.metadata ?? {};
  const chips: string[] = [];
  if (service.type === "drive") {
    // Some API payloads carry a raw byte count as quotaLabel — format it.
    const rawQuota = typeof meta.quotaLabel === "string" ? meta.quotaLabel : null;
    const quotaText =
      rawQuota && /^\d+$/.test(rawQuota) ? formatBytes(Number(rawQuota)) : rawQuota;
    if (quotaText) chips.push(`سهمیه: ${quotaText}`);
    if (meta.planCode) chips.push(`پلن: ${meta.planCode}`);
  } else {
    if (typeof meta.users === "number") chips.push(`${toFaDigits(meta.users)} کاربر`);
    if (typeof meta.endpoints === "number") chips.push(`${toFaDigits(meta.endpoints)} Endpoint`);
  }
  if (meta.packageNameFa) chips.push(String(meta.packageNameFa));
  if (chips.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

export default function PortalServicesView() {
  const router = useRouter();
  const services = useServices();
  const subscriptions = useSubscriptions();

  const isLoading = services.isLoading || subscriptions.isLoading;
  const list = services.data ?? [];
  const subs = subscriptions.data ?? [];

  const activeCount = list.filter((s) => s.status === "active").length;
  const expiredCount = list.filter(
    (s) => s.status === "expired" || (s.expiresAt ? new Date(s.expiresAt).getTime() < Date.now() : false),
  ).length;
  const activeSub = subs.find(
    (sub) => sub.status === "active" && new Date(sub.expiresAt).getTime() > Date.now(),
  );

  return (
    <>
      <PageHeader
        title="سرویس‌های من"
        description="سرویس‌های فعال و اشتراک‌های سازمانی شما در AbrIT"
        breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "سرویس‌های من" }]}
        actions={
          <Button size="sm" onClick={() => router.navigate(routes.portalPlans)}>
            <Plus className="size-3.5" />
            سفارش سرویس جدید
          </Button>
        }
      />

      {services.isError ? (
        <ErrorState
          message="دریافت فهرست سرویس‌ها انجام نشد."
          onRetry={() => services.refetch()}
        />
      ) : isLoading ? (
        <SkeletonCards count={3} />
      ) : (
        <>
          {/* Summary stats */}
          <Reveal className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              icon={<Boxes className="size-5" />}
              label="سرویس‌های فعال"
              value={activeCount}
              helper={`از مجموع ${toFaDigits(list.length)} سرویس ثبت‌شده`}
              animatedNumber
              tone="primary"
            />
            <StatCard
              icon={<Clock className="size-5" />}
              label="سرویس‌های منقضی"
              value={expiredCount}
              helper={expiredCount > 0 ? "برای تمدید، پلن جدیدی سفارش دهید" : "سرویس منقضی‌شده‌ای ندارید"}
              animatedNumber
              tone={expiredCount > 0 ? "warning" : "success"}
            />
            <StatCard
              icon={<Package className="size-5" />}
              label="اشتراک سازمانی"
              value={activeSub ? activeSub.packageNameFa : "بدون اشتراک"}
              helper={
                activeSub
                  ? `اعتبار تا ${formatDateTime(activeSub.expiresAt)}`
                  : "برای فعال‌سازی اشتراک، یک پکیج سفارش دهید"
              }
              tone={activeSub ? "success" : "warning"}
            />
          </Reveal>

          {/* Services grid */}
          {list.length === 0 ? (
            <Reveal className="mt-6">
              <EmptyState
                icon={<Boxes className="size-6" />}
                title="هنوز سرویسی برای شما ثبت نشده است"
                description="با سفارش یکی از پکیج‌های خدمات مدیریت‌شده یا فعال‌سازی فضای ابری AbrIT Drive، سرویس‌های شما اینجا نمایش داده می‌شوند."
                action={
                  <Button size="sm" onClick={() => router.navigate(routes.portalPlans)}>
                    مشاهده پلن‌ها
                  </Button>
                }
              />
            </Reveal>
          ) : (
            <Stagger className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list.map((service) => {
                const isDrive = service.type === "drive";
                const Icon = isDrive ? Cloud : Package;
                return (
                  <StaggerItem key={service.id}>
                    <button
                      type="button"
                      onClick={() => router.navigate(routes.portalService(service.id))}
                      className="group flex h-full w-full flex-col rounded-xl border bg-card p-5 text-start shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
                              isDrive ? "bg-info/10 text-info" : "bg-primary/10 text-primary"
                            }`}
                            aria-hidden="true"
                          >
                            <Icon className="size-5" />
                          </span>
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-extrabold">{service.title}</h3>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {SERVICE_TYPE_LABEL[service.type]}
                            </p>
                          </div>
                        </div>
                        <StatusBadge status={service.status} />
                      </div>

                      <ServiceMeta service={service} />

                      <div className="mt-auto grid grid-cols-2 gap-2 border-t pt-3.5 text-[11px] text-muted-foreground">
                        <div>
                          <p className="font-bold">فعال‌سازی</p>
                          <p className="mt-0.5">{formatDateTime(service.activatedAt)}</p>
                        </div>
                        <div>
                          <p className="font-bold">انقضا</p>
                          <p className="mt-0.5">{formatDateTime(service.expiresAt)}</p>
                        </div>
                      </div>

                      <span className="mt-3 flex items-center gap-1 text-[11px] font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        مشاهده جزئیات سرویس
                      </span>
                    </button>
                  </StaggerItem>
                );
              })}
            </Stagger>
          )}
        </>
      )}
    </>
  );
}
