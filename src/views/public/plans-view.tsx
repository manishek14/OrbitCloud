"use client";

// پلن‌ها و تعرفه — the authoritative 1405 tariffs straight from the commerce
// catalog API: package cards, full comparison table and contract policies.
// No hardcoded prices anywhere.

import { useMemo } from "react";
import {
  ArrowLeft,
  BadgePercent,
  CalendarClock,
  ClipboardList,
  Cloud,
  Info,
  ShieldCheck,
  ShoppingCart,
  Star,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useCommerceCatalog, useMe } from "@/lib/api/hooks";
import type { CommercialPackageDTO } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { formatBytes, formatToman, toFaDigits } from "@/lib/format/fa";
import { Button } from "@/components/ui/button";
import { ErrorState, PriceTag, SkeletonCards } from "@/components/abrit/ui";
import { PriceCard, SectionTitle } from "@/components/abrit/price";
import { PlanCarousel } from "@/components/abrit/plan-carousel";
import { Reveal, Stagger, StaggerItem } from "@/components/abrit/motion";

/** Counts render as Persian digits; zero means «not included» → dash. */
function countCell(value: number): string {
  return value > 0 ? toFaDigits(value) : "—";
}

export default function PlansView() {
  const router = useRouter();
  const catalog = useCommerceCatalog();
  const me = useMe();
  const user = me.data?.user ?? null;

  const packages = useMemo(
    () => (catalog.data?.packages ?? []).slice().sort((a, b) => a.order - b.order),
    [catalog.data],
  );

  const handleSelect = (pkg: CommercialPackageDTO) => {
    // The free plan is an ACTIVATION (Orbit Drive 100 MB), not a purchase.
    if (!pkg.orderable) {
      if (user) {
        router.navigate(routes.portalDrive);
        return;
      }
      toast.info("برای فعال‌سازی فضای ابری رایگان ابتدا وارد حساب کاربری شوید.");
      router.navigate(`${routes.login}?next=${encodeURIComponent(routes.portalDrive)}`);
      return;
    }
    if (user) {
      router.navigate(routes.portalPlan(pkg.code));
      return;
    }
    toast.info("برای سفارش ابتدا وارد حساب کاربری شوید.");
    router.navigate(`${routes.login}?next=${encodeURIComponent(routes.portalPlan(pkg.code))}`);
  };

  const comparisonRows: Array<{ label: string; render: (pkg: CommercialPackageDTO) => React.ReactNode }> = [
    { label: "قیمت ماهانه", render: (p) => <PriceTag toman={p.monthlyPriceToman} /> },
    { label: "کاربران", render: (p) => countCell(p.includedUsers) },
    { label: "Endpointها", render: (p) => countCell(p.includedEndpoints) },
    { label: "سرور / VM", render: (p) => countCell(p.includedServers) },
    { label: "سایت‌ها", render: (p) => countCell(p.includedSites) },
    { label: "تجهیزات شبکه", render: (p) => countCell(p.includedNetworkDevices) },
    { label: "فضای ابری", render: (p) => formatBytes(p.driveQuotaBytes) },
    { label: "SLA شروع رسیدگی", render: (p) => p.slaLabelFa },
    { label: "ساعات پشتیبانی", render: (p) => p.supportHoursFa },
    { label: "VPS ابری", render: (p) => p.vpsFa ?? "—" },
    { label: "حضور در محل", render: (p) => p.onSiteFa },
    {
      label: "کاربر اضافه / ماه",
      render: (p) => (
        <span className="tabular-nums">
          {formatToman(p.extraUserFeeTomanPerMonth)} <span className="text-[10px] font-normal">تومان</span>
        </span>
      ),
    },
    {
      label: "Endpoint اضافه / ماه",
      render: (p) => (
        <span className="tabular-nums">
          {formatToman(p.extraEndpointFeeTomanPerMonth)} <span className="text-[10px] font-normal">تومان</span>
        </span>
      ),
    },
  ];

  const policyNotes = catalog.data
    ? [
        { icon: CalendarClock, text: catalog.data.policy.prepaid },
        { icon: BadgePercent, text: catalog.data.policy.discountScope },
        { icon: ClipboardList, text: catalog.data.policy.onboardingScope },
        { icon: Info, text: catalog.data.policy.customAssessment },
        { icon: Timer, text: catalog.data.policy.slaNote },
        { icon: ShoppingCart, text: catalog.data.policy.checkoutNote },
      ]
    : [];

  if (catalog.isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-24">
        <ErrorState
          message="بارگذاری تعرفه پکیج‌ها انجام نشد."
          onRetry={() => catalog.refetch()}
        />
      </div>
    );
  }

  return (
    <div>
      {/* ------------------------------------------ Free Drive trial (100 MB) */}
      <section className="mx-auto max-w-7xl px-4 pt-14 md:px-6 md:pt-20">
        <Reveal>
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 rounded-xl bg-primary/15 p-2.5 text-primary">
                <Cloud className="size-5" />
              </span>
              <div>
                <h3 className="text-sm font-extrabold">۱۰۰ مگابایت فضای ابری Orbit Drive — رایگان</h3>
                <p className="mt-1 max-w-2xl text-xs leading-6 text-muted-foreground">
                  هر مشتری Orbit یک حساب آزمایشی Orbit Drive (Nextcloud) با ۱۰۰ مگابایت فضای رایگان دریافت می‌کند؛
                  با خرید هر پکیج، سهمیه فضای ابری شما به‌طور خودکار مطابق همان پکیج (۱۰ تا ۲۵۰ گیگابایت) ارتقا می‌یابد.
                </p>
              </div>
            </div>
            <Button variant="outline" className="shrink-0" onClick={() => router.navigate(user ? routes.portalDrive : routes.register)}>
              {user ? "مشاهده Orbit Drive" : "ساخت حساب رایگان"}
            </Button>
          </div>
        </Reveal>
      </section>

      {/* ------------------------------------------------------ Packages carousel */}
      <section className="mx-auto max-w-7xl px-4 pt-10 md:px-6 md:pt-12">
        <SectionTitle
          eyebrow="تعرفه رسمی ۱۴۰۵"
          title="پکیج‌های خدمات مدیریت‌شده"
          description="شش پکیج — از پلن رایگان تا سازمانی پلاس. اسلایدها هر ۵ ثانیه جابه‌جا می‌شوند؛ با کشیدن انگشت یا دکمه‌ها مرور کنید."
        />
        {catalog.isLoading || catalog.data === undefined ? (
          <SkeletonCards count={5} />
        ) : (
          <PlanCarousel ariaLabel="پکیج‌های خدمات مدیریت‌شده Orbit">
            {packages.map((pkg) => (
              <PriceCard key={pkg.code} pkg={pkg} ctaLabel="پیکربندی و خرید" onSelect={handleSelect} />
            ))}
          </PlanCarousel>
        )}
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          همه پکیج‌ها در جدول مقایسه و شبکه کامل زیر نیز در دسترس هستند.
        </p>
      </section>

      {/* ---------------------------------------------------- Complete grid (all 6 plans) */}
      <section className="mx-auto max-w-7xl px-4 pt-10 md:px-6">
        <SectionTitle
          eyebrow="مشاهده کامل"
          title="همه پکیج‌ها در یک نگاه"
          description="هیچ پکیجی پنهان نیست؛ هر شش پلن به‌صورت کامل و هم‌زمان قابل مقایسه هستند."
        />
        {catalog.isLoading ? (
          <SkeletonCards count={5} />
        ) : (
          <Stagger className="grid grid-cols-1 items-stretch gap-6 pt-4 sm:grid-cols-2 lg:grid-cols-3">
            {packages.map((pkg) => (
              <StaggerItem key={pkg.code} className="h-full">
                <PriceCard pkg={pkg} ctaLabel="پیکربندی و خرید" onSelect={handleSelect} />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </section>

      {/* --------------------------------------------------- Comparison table */}
      <section className="border-y bg-card/40">
        <div className="mx-auto max-w-7xl px-4 py-14 md:px-6 md:py-20">
          <SectionTitle
            eyebrow="مقایسه پکیج‌ها"
            title="مقایسه کامل ویژگی‌ها"
            description="تمام سهمیه‌ها، SLA و هزینه‌های اضافه در یک نگاه."
          />
          {catalog.isLoading ? (
            <SkeletonCards count={5} />
          ) : (
            <Reveal>
              <div className="overflow-x-auto rounded-2xl border bg-card">
                <table className="w-full min-w-[780px] border-collapse text-sm">
                  <caption className="sr-only">مقایسه ویژگی‌های پکیج‌های خدمات مدیریت‌شده Orbit</caption>
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th
                        scope="col"
                        className="sticky start-0 z-10 min-w-36 bg-muted/95 px-4 py-4 text-start text-xs font-bold text-muted-foreground backdrop-blur"
                      >
                        ویژگی
                      </th>
                      {packages.map((pkg) => (
                        <th
                          key={pkg.code}
                          scope="col"
                          className={cn(
                            "px-4 py-4 text-center text-xs font-extrabold",
                            pkg.featured && "bg-primary/5 text-primary",
                          )}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {pkg.nameFa}
                            {pkg.featured ? <Star className="size-3 fill-current" aria-label="پیشنهاد Orbit" /> : null}
                          </span>
                          <span className="mt-1 block text-[10px] font-normal text-muted-foreground" dir="ltr">
                            {pkg.nameEn}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map((row, rowIndex) => (
                      <tr key={row.label} className={cn("border-b", rowIndex % 2 === 1 && "bg-muted/20", "last:border-0")}>
                        <th
                          scope="row"
                          className="sticky start-0 z-10 min-w-36 bg-card px-4 py-3 text-start text-xs font-bold text-muted-foreground"
                        >
                          {row.label}
                        </th>
                        {packages.map((pkg) => (
                          <td
                            key={pkg.code}
                            className={cn(
                              "px-4 py-3 text-center text-xs leading-6 text-foreground/90",
                              pkg.featured && "bg-primary/5",
                            )}
                          >
                            {row.render(pkg)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-center text-[11px] text-muted-foreground md:hidden">
                برای مشاهده همه پکیج‌ها، جدول را به چپ و راست بکشید.
              </p>
            </Reveal>
          )}
        </div>
      </section>

      {/* -------------------------------------------------- Contract policies */}
      <section className="mx-auto max-w-7xl px-4 py-14 md:px-6 md:py-20">
        <SectionTitle
          eyebrow="شرایط قرارداد"
          title="مدت قرارداد، تخفیف و Onboarding"
          description="قراردادها پیش‌پرداخت هستند؛ تخفیف مدت و هزینه Onboarding دقیقاً مطابق سند تعرفه ۱۴۰۵ محاسبه می‌شود."
        />
        {catalog.isLoading ? (
          <SkeletonCards count={3} />
        ) : (
          <Stagger className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {(catalog.data?.contracts ?? []).map((contract) => (
              <StaggerItem
                key={contract.months}
                className="flex flex-col rounded-2xl border bg-card p-6 transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-extrabold">قرارداد {toFaDigits(contract.months)} ماهه</h3>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                      contract.discountRate > 0 ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {contract.discountLabelFa}
                  </span>
                </div>
                <p className="mt-3 flex items-center gap-2 text-xs leading-6 text-muted-foreground">
                  <ClipboardList className="size-3.5 shrink-0 text-primary" />
                  {contract.onboardingLabelFa}
                </p>
                {contract.noteFa ? (
                  <p className="mt-2 rounded-lg bg-muted/50 p-2.5 text-[10px] leading-5 text-muted-foreground">
                    {contract.noteFa}
                  </p>
                ) : null}
              </StaggerItem>
            ))}
          </Stagger>
        )}

        {catalog.data ? (
          <Reveal delay={0.1}>
            <div className="mt-8 rounded-2xl border bg-card p-6">
              <h3 className="flex items-center gap-2 text-sm font-extrabold">
                <ShieldCheck className="size-4 text-primary" />
                نکات مهم سیاست قیمت‌گذاری و قرارداد
              </h3>
              <ul className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-2">
                {policyNotes.map((note, i) => (
                  <li key={i} className="flex items-start gap-2.5 rounded-xl bg-muted/40 p-3.5 text-xs leading-6 text-foreground/90">
                    <span className="mt-0.5 shrink-0 rounded-lg bg-primary/10 p-1.5 text-primary">
                      <note.icon className="size-3.5" />
                    </span>
                    {note.text}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        ) : null}

        <Reveal delay={0.15}>
          <div className="mt-10 text-center">
            <Button size="lg" className="gap-2" onClick={() => router.navigate(user ? routes.portalPlans : routes.register)}>
              {user ? "سفارش از پنل مشتری" : "ساخت حساب و شروع سفارش"}
              <ArrowLeft className="size-4" />
            </Button>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
