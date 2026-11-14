"use client";

// Customer portal dashboard — every number is real data from the backend:
// services, subscription, recent orders/transactions, Drive usage,
// notifications and tickets.

import {
  Bell,
  Boxes,
  Cloud,
  CreditCard,
  ExternalLink,
  LifeBuoy,
  Package,
  Plus,
  RefreshCcw,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import { Link, useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { usePortalDashboard, useSyncDrive } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  PageHeader,
  StatCard,
  StatusBadge,
  EmptyState,
  ErrorState,
  SkeletonCards,
  PriceTag,
} from "@/components/abrit/ui";
import { DataTable, type Column } from "@/components/abrit/data-table";
import { Reveal } from "@/components/abrit/motion";
import { formatBytes, formatDateTime, formatPercent, toFaDigits } from "@/lib/format/fa";
import type { OrderListEntryDTO, TransactionDTO } from "@/lib/api/types";

export default function PortalDashboardView() {
  const router = useRouter();
  const dashboard = usePortalDashboard();
  const syncDrive = useSyncDrive();

  const data = dashboard.data;

  if (dashboard.isError) {
    return (
      <ErrorState
        message="دریافت اطلاعات داشبورد انجام نشد."
        onRetry={() => dashboard.refetch()}
      />
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title="داشبورد" description="خلاصه وضعیت حساب و سرویس‌های شما" />
        <SkeletonCards count={4} />
      </>
    );
  }

  const driveRelative = data.drive.totalBytes && data.drive.totalBytes > 0
    ? Math.min(1, (data.drive.usedBytes ?? 0) / data.drive.totalBytes)
    : 0;

  const orderColumns: Column<OrderListEntryDTO>[] = [
    {
      key: "orderNumber",
      header: "شماره سفارش",
      cell: (row) => <span className="ltr-iso font-bold" dir="ltr">{row.orderNumber}</span>,
    },
    { key: "status", header: "وضعیت", cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: "total",
      header: "مبلغ",
      cell: (row) => <PriceTag toman={row.totalToman} className="text-xs" />,
    },
    { key: "createdAt", header: "تاریخ", cell: (row) => <span className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span> },
  ];

  const txColumns: Column<TransactionDTO>[] = [
    {
      key: "ref",
      header: "مرجع",
      cell: (row) => <span className="ltr-iso text-xs" dir="ltr">{row.ref}</span>,
    },
    { key: "status", header: "وضعیت", cell: (row) => <StatusBadge status={row.status} /> },
    { key: "amount", header: "مبلغ", cell: (row) => <PriceTag toman={row.amountToman} className="text-xs" /> },
    { key: "createdAt", header: "زمان", cell: (row) => <span className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="داشبورد"
        description="خلاصه وضعیت حساب، سرویس‌ها و فعالیت‌های اخیر شما"
        breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "داشبورد" }]}
        actions={
          <Button variant="outline" size="sm" onClick={() => dashboard.refetch()}>
            <RefreshCcw className="size-3.5" />
            به‌روزرسانی
          </Button>
        }
      />

      {/* Stats */}
      <Reveal className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Boxes className="size-5" />} label="سرویس‌های فعال" value={data.activeServices} helper={`از مجموع ${toFaDigits(data.totalServices)} سرویس`} animatedNumber tone="primary" />
        <StatCard
          icon={<Package className="size-5" />}
          label="اشتراک سازمانی"
          value={data.subscription?.active ? (data.subscription.packageNameFa ?? "فعال") : "بدون اشتراک"}
          helper={data.subscription?.active ? `اعتبار تا ${formatDateTime(data.subscription.expiresAt)}` : "پلن آزمایشی Drive فعال است"}
          tone={data.subscription?.active ? "success" : "warning"}
        />
        <StatCard icon={<Cloud className="size-5" />} label="فضای ابری Drive" value={data.drive.state === "ready" ? formatBytes(data.drive.usedBytes ?? 0) : "—"} helper={data.drive.totalBytes && data.drive.totalBytes > 0 ? `از ${formatBytes(data.drive.totalBytes)}` : "وضعیت: " + (data.drive.planNameFa ?? "فعال نشده")} tone="info" />
        <StatCard icon={<Bell className="size-5" />} label="اعلان‌های خوانده‌نشده" value={data.unreadNotifications} helper={`تیکت‌ها: ${toFaDigits(data.tickets.open)} باز / ${toFaDigits(data.tickets.answered)} پاسخ‌داده`} animatedNumber tone={data.unreadNotifications > 0 ? "warning" : "success"} />
      </Reveal>

      {/* Drive usage + quick actions */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Reveal className="rounded-xl border bg-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-extrabold">
              <Cloud className="size-4 text-primary" />
              فضای ابری AbrIT Drive
            </h3>
            <Link
              to={routes.portalDrive}
              className="flex items-center gap-1 text-[11px] font-bold text-primary hover:text-primary/80"
            >
              مدیریت Drive
              <ExternalLink className="size-3" />
            </Link>
          </div>
          {data.drive.state === "ready" ? (
            <>
              <div className="mt-4 flex items-baseline justify-between">
                <p className="text-xs text-muted-foreground">
                  {formatBytes(data.drive.usedBytes ?? 0)} از {formatBytes(data.drive.totalBytes ?? 0)} استفاده شده
                </p>
                <p className="text-xs font-bold text-primary">{formatPercent(driveRelative)}٪</p>
              </div>
              <Progress value={driveRelative * 100} className="mt-2 h-2.5" />
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={syncDrive.isPending} onClick={() => syncDrive.mutate()}>
                  {syncDrive.isPending ? <RefreshCcw className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
                  همگام‌سازی مصرف
                </Button>
              </div>
            </>
          ) : (
            <div className="mt-4">
              <EmptyState
                icon={<Cloud className="size-6" />}
                title={data.drive.state === "not_provisioned" ? "سرویس Drive هنوز فعال نشده" : "وضعیت Drive در دسترس نیست"}
                description={
                  data.drive.state === "not_provisioned"
                    ? "حساب فضای ابری خود را با چند کلیک فعال کنید؛ سهمیه مطابق پلن شما اعمال می‌شود."
                    : "وضعیت سرور Drive هم‌اکنون قابل دریافت نیست؛ از صفحه AbrIT Drive دوباره تلاش کنید."
                }
                action={
                  <Button size="sm" onClick={() => router.navigate(routes.portalDrive)}>
                    رفتن به صفحه Drive
                  </Button>
                }
                className="border-0 bg-transparent py-8"
              />
            </div>
          )}
        </Reveal>

        <Reveal delay={0.08} className="rounded-xl border bg-card p-5">
          <h3 className="text-sm font-extrabold">دسترسی سریع</h3>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {[
              { label: "خرید پلن", icon: Package, to: routes.portalPlans },
              { label: "سفارش‌ها", icon: Receipt, to: routes.portalOrders },
              { label: "فاکتورها", icon: CreditCard, to: routes.portalBilling },
              { label: "تیکت جدید", icon: LifeBuoy, to: routes.portalTickets },
              { label: "امنیت", icon: ShieldCheck, to: routes.portalSecurity },
              { label: "سبد خرید", icon: Plus, to: routes.portalCart },
            ].map((action) => (
              <Link
                key={action.to}
                to={action.to}
                className="flex flex-col items-center gap-2 rounded-xl border bg-background/60 p-3.5 text-center transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
              >
                <action.icon className="size-4.5 text-primary" />
                <span className="text-[10px] font-bold leading-4">{action.label}</span>
              </Link>
            ))}
          </div>
        </Reveal>
      </div>

      {/* Recent orders + transactions */}
      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Reveal>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-extrabold">سفارش‌های اخیر</h3>
            <Link to={routes.portalOrders} className="text-[11px] font-bold text-primary hover:text-primary/80">
              همه سفارش‌ها
            </Link>
          </div>
          <DataTable
            columns={orderColumns}
            rows={data.recentOrders}
            rowKey={(row) => row.id}
            loading={dashboard.isLoading}
            emptyTitle="هنوز سفارشی ثبت نکرده‌اید"
            emptyDescription="پکیج مناسب کسب‌وکار خود را انتخاب و سفارش دهید."
            emptyAction={
              <Button size="sm" onClick={() => router.navigate(routes.portalPlans)}>
                مشاهده پلن‌ها
              </Button>
            }
            pageSize={5}
            onRowClick={(row) => router.navigate(routes.portalOrders)}
          />
        </Reveal>

        <Reveal delay={0.08}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-extrabold">تراکنش‌های اخیر</h3>
            <Link to={routes.portalBilling} className="text-[11px] font-bold text-primary hover:text-primary/80">
              همه پرداخت‌ها
            </Link>
          </div>
          <DataTable
            columns={txColumns}
            rows={data.recentTransactions}
            rowKey={(row) => row.id}
            loading={dashboard.isLoading}
            emptyTitle="تراکنشی ثبت نشده است"
            emptyDescription="پس از اولین پرداخت، تراکنش‌های شما اینجا نمایش داده می‌شوند."
            pageSize={5}
          />
        </Reveal>
      </div>
    </>
  );
}
