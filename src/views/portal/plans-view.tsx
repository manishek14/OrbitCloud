"use client";

// پلن‌ها و اشتراک — the full 1405 commercial catalog (all values from
// /api/commerce/catalog, never hardcoded) plus the customer's active
// subscription banner, contract policies and honest policy notes.

import {
  BadgePercent,
  Boxes,
  CalendarClock,
  FileCheck2,
  Info,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link, useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useCommerceCatalog, useSubscriptions } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import {
  PageHeader,
  EmptyState,
  ErrorState,
  SkeletonCards,
} from "@/components/abrit/ui";
import { PriceCard, SectionTitle } from "@/components/abrit/price";
import { Reveal, Stagger, StaggerItem } from "@/components/abrit/motion";
import { formatDateTime, toFaDigits } from "@/lib/format/fa";

export default function PortalPlansView() {
  const router = useRouter();
  const catalog = useCommerceCatalog();
  const subscriptions = useSubscriptions();

  const data = catalog.data;

  if (catalog.isError) {
    return (
      <>
        <PageHeader
          title="پلن‌ها و تعرفه"
          description="پکیج‌های خدمات مدیریت‌شده IT — تعرفه رسمی ۱۴۰۵"
          breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "پلن‌ها و تعرفه" }]}
        />
        <ErrorState message="دریافت کاتالوگ پکیج‌ها انجام نشد." onRetry={() => catalog.refetch()} />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader
          title="پلن‌ها و تعرفه"
          description="پکیج‌های خدمات مدیریت‌شده IT — تعرفه رسمی ۱۴۰۵"
          breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "پلن‌ها و تعرفه" }]}
        />
        <SkeletonCards count={5} />
      </>
    );
  }

  const activeSub = (subscriptions.data ?? []).find(
    (sub) => sub.status === "active" && new Date(sub.expiresAt).getTime() > Date.now(),
  );

  return (
    <>
      <PageHeader
        title="پلن‌ها و تعرفه"
        description="پکیج‌های خدمات مدیریت‌شده فناوری اطلاعات Orbit — قیمت‌ها ماهانه و بر پایه تعرفه رسمی ۱۴۰۵ محاسبه می‌شوند."
        breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "پلن‌ها و تعرفه" }]}
      />

      {/* Active subscription banner */}
      {activeSub ? (
        <Reveal className="mb-6 overflow-hidden rounded-2xl border border-success/30 bg-gradient-to-l from-success/10 via-primary/10 to-primary/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success" aria-hidden="true">
                <ShieldCheck className="size-5.5" />
              </span>
              <div>
                <p className="text-sm font-extrabold">
                  اشتراک فعال شما: پکیج {activeSub.packageNameFa}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <CalendarClock className="size-3.5" />
                  اعتبار تا {formatDateTime(activeSub.expiresAt)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => router.navigate(routes.portalServices)}>
                <Boxes className="size-3.5" />
                سرویس‌های من
              </Button>
              <Button size="sm" onClick={() => router.navigate(routes.portalOrders)}>
                سفارش‌ها
              </Button>
            </div>
          </div>
        </Reveal>
      ) : null}

      {/* Packages */}
      {data.packages.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="size-6" />}
          title="در حال حاضر پکیجی برای فروش فعال نیست."
          description="به‌زودی پکیج‌های ۱۴۰۵ معرفی می‌شوند."
        />
      ) : (
        <Stagger className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {data.packages.map((pkg) => (
            <StaggerItem key={pkg.code} className="h-full">
              <PriceCard
                pkg={pkg}
                ctaLabel="سفارش و پیکربندی"
                onSelect={(p) => router.navigate(routes.portalPlan(p.code))}
              />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      {/* Contract policies */}
      <Reveal className="mt-12">
        <SectionTitle
          eyebrow="سیاست قرارداد"
          title="مدت قرارداد و تخفیف‌ها"
          description="قراردادها پیش‌پرداخت و در سه مدت ۱، ۳ و ۶ ماهه هستند؛ تخفیف مدت فقط برای ۳ و ۶ ماهه روی قیمت پایه پکیج اعمال می‌شود."
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {data.contracts.map((contract) => (
            <div
              key={contract.months}
              className="rounded-xl border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-extrabold">
                  <CalendarClock className="size-4 text-primary" />
                  {contract.labelFa}
                </span>
                <span className="flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-0.5 text-[11px] font-bold text-success">
                  <BadgePercent className="size-3" />
                  {contract.discountLabelFa}
                </span>
              </div>
              <p className="mt-3 text-[11px] leading-6 text-muted-foreground">
                {contract.onboardingLabelFa}
              </p>
            </div>
          ))}
        </div>
      </Reveal>

      {/* Policy notes */}
      <Reveal delay={0.06} className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-card/60 p-4">
          <p className="flex items-center gap-2 text-xs font-extrabold">
            <FileCheck2 className="size-4 text-primary" />
            پیش‌پرداخت
          </p>
          <p className="mt-2 text-[11px] leading-6 text-muted-foreground">{data.policy.prepaid}</p>
        </div>
        <div className="rounded-xl border bg-card/60 p-4">
          <p className="flex items-center gap-2 text-xs font-extrabold">
            <Sparkles className="size-4 text-primary" />
            برآورد سفارشی
          </p>
          <p className="mt-2 text-[11px] leading-6 text-muted-foreground">{data.policy.customAssessment}</p>
        </div>
        <div className="rounded-xl border bg-card/60 p-4">
          <p className="flex items-center gap-2 text-xs font-extrabold">
            <Info className="size-4 text-primary" />
            نکته SLA
          </p>
          <p className="mt-2 text-[11px] leading-6 text-muted-foreground">{data.policy.slaNote}</p>
        </div>
      </Reveal>

      <Reveal delay={0.1} className="mt-8 rounded-xl border border-primary/20 bg-primary/5 p-5 text-center">
        <p className="text-xs leading-6 text-muted-foreground">
          مبلغ نهایی سفارش همیشه سمت سرور از موتور قیمت‌گذاری رسمی بازمحاسبه و در اسنپ‌شات تغییرناپذیر ثبت می‌شود.
          برای مشاهده برآورد لحظه‌ای، پکیج موردنظر را انتخاب و پیکربندی کنید.
        </p>
        <div className="mt-3">
          <Link to={routes.portalServices} className="text-[11px] font-bold text-primary hover:text-primary/80">
            مشاهده سرویس‌های فعال من
          </Link>
        </div>
      </Reveal>
    </>
  );
}
