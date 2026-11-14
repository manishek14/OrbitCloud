"use client";

// Plan/price presentation components (public site + portal). All commercial
// values come from the /api/commerce/catalog response — never hardcoded.

import type { ReactNode } from "react";
import { Check, Cloud, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, toFaDigits } from "@/lib/format/fa";
import type { CommercialPackageDTO } from "@/lib/api/types";
import { PriceTag } from "./ui";

export function PriceCard({
  pkg,
  onSelect,
  ctaLabel = "انتخاب پکیج",
  ctaLabelFree = "فعال‌سازی رایگان",
  compact = false,
}: {
  pkg: CommercialPackageDTO;
  onSelect?: (pkg: CommercialPackageDTO) => void;
  ctaLabel?: string;
  /** CTA for the non-purchasable free plan (activation, not checkout). */
  ctaLabelFree?: string;
  compact?: boolean;
}) {
  const free = !pkg.orderable;
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border bg-card p-6 transition-all duration-200",
        pkg.featured
          ? "border-primary/60 shadow-lg shadow-primary/10"
          : free
            ? "border-success/40"
            : "border-border hover:border-primary/40 hover:shadow-md",
        "hover:-translate-y-1",
      )}
    >
      {pkg.featured ? (
        <span className="absolute -top-3.5 start-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3.5 py-1 text-[11px] font-bold text-primary-foreground shadow-md">
          <Star className="size-3 fill-current" />
          پیشنهاد AbrIT
        </span>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-extrabold">{pkg.nameFa}</h3>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{pkg.audienceFa}</p>
        </div>
        <span className="rounded-lg bg-primary/10 p-2.5 text-primary" title="فضای ابری AbrIT Drive">
          <Cloud className="size-5" />
        </span>
      </div>

      <div className="mt-5">
        {free ? (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-success">رایگان</span>
              <span className="text-xs text-muted-foreground">— بدون هزینه</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
              بدون قیمت پایه و بدون قرارداد؛ فعال‌سازی از پنل کاربری انجام می‌شود.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold">
                <PriceTag toman={pkg.monthlyPriceToman} />
              </span>
              <span className="text-xs text-muted-foreground">/ ماه</span>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              قرارداد ۱، ۳ یا ۶ ماهه و پیش‌پرداخت — تخفیف مدت فقط در ۳ ماهه (۳٪) و ۶ ماهه (۵٪)
            </p>
          </>
        )}
      </div>

      {free ? (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-success/30 bg-success/5 p-3 text-center">
          <div className="flex items-center gap-2">
            <Cloud className="size-5 shrink-0 text-success" aria-hidden="true" />
            <div className="text-start">
              <p className="text-sm font-extrabold">۱۰۰ مگابایت فضای ابری</p>
              <p className="text-[10px] leading-4 text-muted-foreground">AbrIT Drive — بدون هزینه</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-muted/60 p-3 text-center">
            <div>
              <p className="text-sm font-extrabold">{toFaDigits(pkg.includedUsers)}</p>
              <p className="text-[10px] text-muted-foreground">کاربر</p>
            </div>
            <div className="border-x border-border">
              <p className="text-sm font-extrabold">{toFaDigits(pkg.includedEndpoints)}</p>
              <p className="text-[10px] text-muted-foreground">Endpoint</p>
            </div>
            <div>
              <p className="text-sm font-extrabold">{formatBytes(pkg.driveQuotaBytes)}</p>
              <p className="text-[10px] text-muted-foreground">فضای ابری</p>
            </div>
          </div>

          <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
            کاربر اضافه: <PriceTag toman={pkg.extraUserFeeTomanPerMonth} className="text-[11px] font-bold" /> /ماه —
            Endpoint اضافه: <PriceTag toman={pkg.extraEndpointFeeTomanPerMonth} className="text-[11px] font-bold" /> /ماه
          </p>
        </>
      )}

      <ul className={cn("mt-5 flex-1 space-y-2.5", compact && "text-xs")}>
        {pkg.benefitsFa.map((benefit) => (
          <li key={benefit} className="flex items-start gap-2 text-xs leading-6 text-foreground/90">
            <Check className="mt-1 size-3.5 shrink-0 text-success" />
            {benefit}
          </li>
        ))}
        <li className="flex items-start gap-2 text-xs leading-6 text-foreground/90">
          <Check className="mt-1 size-3.5 shrink-0 text-success" />
          SLA: {pkg.slaLabelFa}
        </li>
      </ul>

      <div className="mt-5 border-t pt-4">
        <p className="text-[10px] text-muted-foreground">پشتیبانی: {pkg.supportHoursFa}</p>
        {onSelect ? (
          <button
            onClick={() => onSelect(pkg)}
            className={cn(
              "mt-3 h-10 w-full rounded-lg text-sm font-bold transition-all active:scale-[0.98]",
              pkg.featured
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : free
                  ? "border border-success/60 text-success hover:bg-success/10"
                  : "border border-primary/50 text-primary hover:bg-primary/10",
            )}
          >
            {free ? ctaLabelFree : ctaLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function QuotaBadge({ quotaBytes }: { quotaBytes: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
      <Cloud className="size-3" />
      {formatBytes(quotaBytes)}
    </span>
  );
}

export function ContractOptionCard({
  months,
  discountLabel,
  onboardingLabel,
  selected,
  onSelect,
}: {
  months: number;
  discountLabel: string;
  onboardingLabel?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full flex-col items-start gap-1 rounded-xl border p-3.5 text-start transition-all",
        selected
          ? "border-primary bg-primary/10 ring-2 ring-primary/20"
          : "border-border hover:border-primary/40 hover:bg-accent",
      )}
    >
      <span className="flex w-full items-center justify-between">
        <span className="text-sm font-extrabold">قرارداد {toFaDigits(months)} ماهه</span>
        <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">
          {discountLabel}
        </span>
      </span>
      {onboardingLabel ? <span className="text-[10px] leading-4 text-muted-foreground">{onboardingLabel}</span> : null}
    </button>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  description,
  center = true,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  center?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className={cn("mb-10 flex flex-col gap-3", center && "items-center text-center")}>
      {eyebrow ? (
        <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">
          {eyebrow}
        </span>
      ) : null}
      <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">{title}</h2>
      {description ? (
        <p className={cn("max-w-2xl text-sm leading-7 text-muted-foreground", center && "mx-auto")}>{description}</p>
      ) : null}
      {action}
    </div>
  );
}
