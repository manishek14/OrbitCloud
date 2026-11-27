"use client";

// جزئیات پلن — live quote configurator: package summary, contract length,
// user/endpoint steppers; the sidebar shows the server-computed quote
// (debounced 400ms) and add-to-cart. No price is ever computed client-side.

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Info,
  Loader2,
  Minus,
  Package as PackageIcon,
  Plus,
  ShoppingCart,
  Users,
} from "lucide-react";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useAddToCart, useCommerceCatalog, useQuoteQuery } from "@/lib/api/hooks";
import { ApiRequestError, errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PageHeader,
  ErrorState,
  PriceTag,
} from "@/components/abrit/ui";
import { ContractOptionCard, QuotaBadge } from "@/components/abrit/price";
import { Reveal } from "@/components/abrit/motion";
import { toast } from "sonner";
import { formatBytes, formatToman, toFaDigits } from "@/lib/format/fa";
import type { QuoteInputDTO } from "@/lib/api/types";

/** Local 400ms debounce for the live quote. */
function useDebounced<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Touch-friendly numeric stepper (users / endpoints). */
function Stepper({
  label,
  value,
  min,
  max,
  hint,
  onChange,
  id,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  hint?: string;
  onChange: (next: number) => void;
  id: string;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <label htmlFor={id} className="text-xs font-extrabold">
            {label}
          </label>
          {hint ? <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{hint}</p> : null}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange(clamp(value - 1))}
            disabled={value <= min}
            className="flex size-10 items-center justify-center rounded-lg border transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`کاهش ${label}`}
          >
            <Minus className="size-4" />
          </button>
          <input
            id={id}
            dir="ltr"
            inputMode="numeric"
            value={toFaDigits(value)}
            readOnly
            aria-readonly
            className="h-10 w-14 rounded-lg border bg-background text-center text-sm font-extrabold tabular-nums outline-none"
          />
          <button
            type="button"
            onClick={() => onChange(clamp(value + 1))}
            disabled={value >= max}
            className="flex size-10 items-center justify-center rounded-lg border transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`افزایش ${label}`}
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PortalPlanDetailView({ code }: { code: string }) {
  const router = useRouter();
  const catalog = useCommerceCatalog();
  const data = catalog.data;

  const pkg = data?.packages.find((p) => p.code === code) ?? null;

  // Configurator state — null means "use the package default" (derived during
  // render; no effects). Explicit state is set by user interaction only.
  const [months, setMonths] = useState<number | null>(null);
  const [users, setUsers] = useState<number | null>(null);
  const [endpoints, setEndpoints] = useState<number | null>(null);
  const addToCart = useAddToCart();

  const effectiveMonths = months ?? data?.policy.minimumMonths ?? 3;
  const effectiveUsers = users ?? pkg?.includedUsers ?? 1;
  const effectiveEndpoints = endpoints ?? pkg?.includedEndpoints ?? 1;
  const liveInput: QuoteInputDTO | null = pkg
    ? { packageCode: code, months: effectiveMonths, users: effectiveUsers, endpoints: effectiveEndpoints }
    : null;
  const debouncedInput = useDebounced(liveInput, 400);
  const quote = useQuoteQuery(debouncedInput);

  if (catalog.isError) {
    return (
      <>
        <PageHeader
          title="سفارش پکیج"
          breadcrumbs={[
            { label: "پنل کاربری", to: routes.portal },
            { label: "پلن‌ها و تعرفه", to: routes.portalPlans },
            { label: "سفارش پکیج" },
          ]}
        />
        <ErrorState message="دریافت اطلاعات پکیج انجام نشد." onRetry={() => catalog.refetch()} />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader
          title="سفارش پکیج"
          breadcrumbs={[
            { label: "پنل کاربری", to: routes.portal },
            { label: "پلن‌ها و تعرفه", to: routes.portalPlans },
            { label: "در حال بارگذاری…" },
          ]}
        />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
          <Skeleton className="h-96 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </>
    );
  }

  if (!pkg) {
    return (
      <>
        <PageHeader
          title="پکیج یافت نشد"
          breadcrumbs={[
            { label: "پنل کاربری", to: routes.portal },
            { label: "پلن‌ها و تعرفه", to: routes.portalPlans },
            { label: "پکیج نامعتبر" },
          ]}
        />
        <ErrorState message="پکیج موردنظر یافت نشد؛ ممکن است آدرس اشتباه باشد." />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => router.navigate(routes.portalPlans)}>
            <ArrowRight className="size-3.5" />
            بازگشت به پلن‌ها
          </Button>
        </div>
      </>
    );
  }

  // The free plan is an activation, not a purchase — route it to Drive.
  if (!pkg.orderable) {
    return (
      <>
        <PageHeader
          title={`پکیج ${pkg.nameFa}`}
          description={pkg.audienceFa}
          breadcrumbs={[
            { label: "پنل کاربری", to: routes.portal },
            { label: "پلن‌ها و تعرفه", to: routes.portalPlans },
            { label: pkg.nameFa },
          ]}
        />
        <div className="mx-auto max-w-xl rounded-2xl border border-success/30 bg-success/5 p-6 text-center">
          <h2 className="text-sm font-extrabold">پلن رایگان نیازی به خرید ندارد</h2>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            فضای ابری ۱۰۰ مگابایتی Orbit Drive از صفحه Orbit Drive و با یک کلیک فعال می‌شود؛
            برای خدمات مدیریت‌شده یکی از پکیج‌های پولی را انتخاب کنید.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button onClick={() => router.navigate(routes.portalDrive)}>فعال‌سازی Orbit Drive</Button>
            <Button variant="outline" onClick={() => router.navigate(routes.portalPlans)}>
              مشاهده پکیج‌های خرید
            </Button>
          </div>
        </div>
      </>
    );
  }

  const quoteData = quote.data ?? null;
  const needsAssessment = quoteData ? quoteData.needsCustomAssessment || !quoteData.valid : false;
  const canCheckout = quoteData?.valid && !quoteData.needsCustomAssessment && quoteData.checkoutEnabled;

  const handleAddToCart = () => {
    if (!liveInput) return;
    addToCart.mutate(liveInput, {
      onSuccess: () => {
        toast.success("به سبد خرید اضافه شد");
        router.navigate(routes.portalCart);
      },
      onError: (error) => {
        if (error instanceof ApiRequestError && error.code === "NEEDS_CUSTOM_ASSESSMENT") {
          toast.error("برای این تعداد کاربر/Endpoint، ابتدا Assessment سازمانی لازم است.");
        } else {
          toast.error(errorMessage(error));
        }
      },
    });
  };

  return (
    <>
      <PageHeader
        title={`سفارش پکیج ${pkg.nameFa}`}
        description={pkg.audienceFa}
        breadcrumbs={[
          { label: "پنل کاربری", to: routes.portal },
          { label: "پلن‌ها و تعرفه", to: routes.portalPlans },
          { label: pkg.nameFa },
        ]}
        actions={
          <Button variant="outline" size="sm" onClick={() => router.navigate(routes.portalPlans)}>
            <ArrowRight className="size-3.5" />
            بازگشت به پلن‌ها
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Right column (RTL): configurator */}
        <div className="min-w-0 space-y-5">
          {/* Package summary */}
          <Reveal className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
                  <PackageIcon className="size-5" />
                </span>
                <div>
                  <h2 className="text-sm font-extrabold">
                    پکیج {pkg.nameFa} <span className="ltr-iso text-[11px] font-medium text-muted-foreground" dir="ltr">({pkg.nameEn})</span>
                  </h2>
                  <p className="mt-1 text-[11px] text-muted-foreground">{pkg.audienceFa}</p>
                </div>
              </div>
              <div className="text-end">
                <p className="text-lg font-extrabold">
                  <PriceTag toman={pkg.monthlyPriceToman} />
                </p>
                <p className="text-[10px] text-muted-foreground">قیمت پایه / ماه (پیش از تخفیف مدت)</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <QuotaBadge quotaBytes={pkg.driveQuotaBytes} />
              <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] font-bold">
                {toFaDigits(pkg.includedUsers)} کاربر
              </span>
              <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] font-bold">
                {toFaDigits(pkg.includedEndpoints)} Endpoint
              </span>
              <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] font-bold">
                SLA: {pkg.slaLabelFa}
              </span>
              {pkg.includedServers > 0 ? (
                <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] font-bold">
                  {toFaDigits(pkg.includedServers)} سرور
                </span>
              ) : null}
            </div>
          </Reveal>

          {/* Contract length */}
          <Reveal delay={0.05} className="rounded-xl border bg-card p-5">
            <h3 className="text-sm font-extrabold">مدت قرارداد</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {data.policy.discountScope}
            </p>
            <div role="radiogroup" aria-label="مدت قرارداد" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {data.contracts.map((contract) => (
                <ContractOptionCard
                  key={contract.months}
                  months={contract.months}
                  discountLabel={contract.discountLabelFa}
                  onboardingLabel={contract.onboardingLabelFa}
                  selected={effectiveMonths === contract.months}
                  onSelect={() => setMonths(contract.months)}
                />
              ))}
            </div>
          </Reveal>

          {/* Capacity steppers */}
          <Reveal delay={0.1} className="rounded-xl border bg-card p-5">
            <h3 className="flex items-center gap-2 text-sm font-extrabold">
              <Users className="size-4 text-primary" />
              ظرفیت سازمان شما
            </h3>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Stepper
                id="stepper-users"
                label="تعداد کاربر"
                value={effectiveUsers}
                min={1}
                max={60}
                hint={`شامل ${toFaDigits(pkg.includedUsers)} کاربر — کاربر اضافه: ${formatToman(pkg.extraUserFeeTomanPerMonth)} تومان/ماه`}
                onChange={setUsers}
              />
              <Stepper
                id="stepper-endpoints"
                label="تعداد Endpoint"
                value={effectiveEndpoints}
                min={1}
                max={80}
                hint={`شامل ${toFaDigits(pkg.includedEndpoints)} دستگاه — دستگاه اضافه: ${formatToman(pkg.extraEndpointFeeTomanPerMonth)} تومان/ماه`}
                onChange={setEndpoints}
              />
            </div>
            <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-[10px] leading-5 text-muted-foreground">
              کاربر و Endpoint اضافه با قیمت کامل محاسبه می‌شوند (تخفیف مدت فقط روی قیمت پایه).
            </p>
          </Reveal>
        </div>

        {/* Left column (lg): sticky live quote */}
        <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <Reveal delay={0.08} className="overflow-hidden rounded-xl border border-primary/30 bg-card shadow-lg shadow-primary/5">
            <div className="border-b bg-primary/5 px-5 py-4">
              <h3 className="text-sm font-extrabold">برآورد لحظه‌ای سفارش</h3>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                محاسبه سمت سرور بر پایه تعرفه رسمی ۱۴۰۵
              </p>
            </div>

            <div className="px-5 py-4">
              {quote.isError ? (
                <ErrorState
                  message="دریافت برآورد انجام نشد."
                  onRetry={() => quote.refetch()}
                  className="border-0 bg-transparent py-6"
                />
              ) : !quoteData ? (
                <div className="space-y-2.5 py-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="mt-4 h-9 w-2/3" />
                </div>
              ) : (
                <div
                  className={`space-y-3 transition-opacity ${quote.isFetching ? "opacity-50" : "opacity-100"}`}
                  aria-busy={quote.isFetching}
                >
                  {/* Line items */}
                  <ul className="space-y-2.5">
                    {quoteData.lineItems.map((item) => {
                      const negative = item.amountToman < 0;
                      return (
                        <li key={item.key} className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-bold">{item.labelFa}</p>
                            {item.noteFa ? (
                              <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{item.noteFa}</p>
                            ) : null}
                          </div>
                          <p
                            className={`shrink-0 text-xs font-extrabold tabular-nums ${
                              negative ? "text-success" : ""
                            }`}
                          >
                            {negative ? "−" : ""}
                            <PriceTag toman={Math.abs(item.amountToman)} />
                          </p>
                        </li>
                      );
                    })}
                  </ul>

                  {/* Total */}
                  <div className="rounded-xl bg-muted/60 p-4 text-center">
                    <p className="text-[11px] font-bold text-muted-foreground">مبلغ کل قرارداد</p>
                    <p className="mt-1.5 text-2xl font-extrabold text-primary">
                      <PriceTag toman={quoteData.breakdown?.totalToman ?? null} />
                    </p>
                    {quoteData.breakdown ? (
                      <p className="mt-1.5 text-[10px] text-muted-foreground">
                        معادل ماهانه: {formatToman(quoteData.breakdown.perMonthEquivalentToman)} تومان
                      </p>
                    ) : null}
                    {quoteData.snapshot ? (
                      <p className="mt-2 text-[9px] text-muted-foreground/70">
                        شناسه برآورد: {" "}
                        <span className="ltr-iso" dir="ltr">{quoteData.snapshot.quoteId}</span>
                      </p>
                    ) : null}
                  </div>

                  {/* Custom assessment notice */}
                  {needsAssessment ? (
                    <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
                      <p className="flex items-center gap-2 text-xs font-extrabold text-warning">
                        <Info className="size-4 shrink-0" />
                        نیازمند برآورد اختصاصی
                      </p>
                      <p className="mt-2 text-[11px] leading-6 text-warning/90">
                        برای بیش از {toFaDigits(data.limits.maxQuotableUsers)} کاربر یا {" "}
                        {toFaDigits(data.limits.maxQuotableEndpoints)} Endpoint، پکیج Enterprise Custom پس از
                        Assessment اولیه برآورد می‌شود.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full border-warning/50 text-warning hover:bg-warning/10"
                        onClick={() => router.navigate(routes.contact)}
                      >
                        درخواست Assessment و تماس با Orbit
                      </Button>
                    </div>
                  ) : (
                    <Button
                      className="h-11 w-full"
                      disabled={!canCheckout || addToCart.isPending || quote.isFetching}
                      onClick={handleAddToCart}
                    >
                      {addToCart.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ShoppingCart className="size-4" />
                      )}
                      افزودن به سبد خرید
                    </Button>
                  )}

                  <p className="flex items-start gap-1.5 text-[10px] leading-5 text-muted-foreground">
                    <Check className="mt-0.5 size-3 shrink-0 text-success" />
                    {data.policy.checkoutNote}
                  </p>
                </div>
              )}
            </div>
          </Reveal>
        </div>
      </div>
    </>
  );
}
