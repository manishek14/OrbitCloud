"use client";

// تسویه حساب — فرایند سه‌ مرحله‌ای: مرور سفارش ← اطلاعات فاکتور ← تأیید و پرداخت.
// نکته مهم: سبد خرید پس از ثبت سفارش در سرور «مصرف» می‌شود؛ بنابراین پس از checkout
// فقط از داده‌های سفارش ثبت‌شده (Order Snapshot) استفاده می‌کنیم، نه از سبد زنده.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CreditCard,
  Info,
  Loader2,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useCart, useCheckout, useInitPayment, useMe, useSelectableGateways } from "@/lib/api/hooks";
import { errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  ErrorState,
  FullPageLoader,
  PageHeader,
  PriceTag,
  SkeletonRows,
  StatusBadge,
} from "@/components/abrit/ui";
import { FormField, TextField } from "@/components/abrit/form-field";
import { Reveal } from "@/components/abrit/motion";
import { formatToman, toFaDigits } from "@/lib/format/fa";
import type { CartItemDTO, OrderDTO } from "@/lib/api/types";

type Step = 1 | 2 | 3;

const STEP_LABELS = ["مرور سفارش", "اطلاعات فاکتور", "تأیید و پرداخت"] as const;

interface SummaryLine {
  key: string;
  name: string;
  months: number;
  users: number;
  endpoints: number;
  total: number;
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
      {children}
    </span>
  );
}

function LineAmount({ amount }: { amount: number }) {
  if (amount < 0) {
    return (
      <span className="shrink-0 font-bold tabular-nums text-success">
        −{formatToman(Math.abs(amount))} <span className="text-[10px] font-normal">تومان</span>
      </span>
    );
  }
  if (amount === 0) {
    return <span className="shrink-0 text-[11px] text-muted-foreground">بدون هزینه</span>;
  }
  return (
    <span className="shrink-0 tabular-nums">
      {formatToman(amount)} <span className="text-[10px] text-muted-foreground">تومان</span>
    </span>
  );
}

/** کارت مرور یک قلم سبد (بدون امکان حذف — حذف فقط از صفحه سبد خرید). */
function ReviewItemCard({ item }: { item: CartItemDTO }) {
  const quote = item.quote;
  const breakdown = quote.breakdown;
  return (
    <article className="rounded-xl border bg-card p-4 sm:p-5">
      <h3 className="text-sm font-extrabold">{breakdown?.packageNameFa ?? item.input.packageCode}</h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip>مدت {toFaDigits(item.input.months)} ماه</Chip>
        <Chip>{toFaDigits(item.input.users)} کاربر</Chip>
        <Chip>{toFaDigits(item.input.endpoints)} Endpoint</Chip>
      </div>
      {breakdown ? (
        <>
          <ul className="mt-4 space-y-2.5 border-t pt-3.5">
            {quote.lineItems.map((line) => (
              <li key={line.key} className="flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold leading-5">{line.labelFa}</p>
                  {line.noteFa ? (
                    <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{line.noteFa}</p>
                  ) : null}
                </div>
                <LineAmount amount={line.amountToman} />
              </li>
            ))}
          </ul>
          <div className="mt-3.5 flex items-center justify-between border-t pt-3.5">
            <span className="text-xs font-bold text-muted-foreground">جمع این قلم</span>
            <PriceTag toman={breakdown.totalToman} className="text-sm font-extrabold" />
          </div>
        </>
      ) : (
        <p className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-[11px] leading-5 text-warning">
          استعلام این قلم معتبر نیست؛ به صفحه سبد خرید بازگردید و قلم را دوباره اضافه کنید.
        </p>
      )}
      {quote.snapshot ? (
        <p className="ltr-iso mt-2.5 font-mono text-[10px] text-muted-foreground/70" dir="ltr">
          quote: {quote.snapshot.quoteId}
        </p>
      ) : null}
    </article>
  );
}

/** نشانگر مراحل با دایره‌های شماره‌دار فارسی. */
function StepIndicator({ current }: { current: Step }) {
  return (
    <ol className="flex items-center gap-2" aria-label="مراحل تسویه حساب">
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as Step;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-extrabold transition-all ${
                done
                  ? "border-primary bg-primary text-primary-foreground"
                  : active
                    ? "border-primary text-primary ring-4 ring-primary/15"
                    : "border-border text-muted-foreground"
              }`}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="size-4" /> : toFaDigits(n)}
            </span>
            <span
              className={`hidden truncate text-[11px] font-bold sm:block ${
                active ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
            {i < STEP_LABELS.length - 1 ? (
              <span className={`h-px flex-1 ${done ? "bg-primary" : "bg-border"}`} aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default function CheckoutView() {
  const router = useRouter();
  const cart = useCart();
  const me = useMe();
  const checkout = useCheckout();
  const initPayment = useInitPayment();
  const gateways = useSelectableGateways();

  const [step, setStep] = useState<Step>(1);
  const [direction, setDirection] = useState(1);
  const [createdOrder, setCreatedOrder] = useState<OrderDTO | null>(null);
  const [paying, setPaying] = useState(false);
  const [gatewayId, setGatewayId] = useState<string>("zarinpal");

  const available = gateways.data ?? [];
  // Derived effective selection (no state-sync effect): falls back to the
  // first available gateway when the stored selection is no longer offered.
  const effectiveGatewayId = available.some((g) => g.gateway === gatewayId)
    ? gatewayId
    : available[0]?.gateway ?? gatewayId;

  // مقدار فیلدهای فاکتور: تا وقتی کاربر دست نزده، از پروفایل مشتق می‌شود (بدون effect).
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [companyOverride, setCompanyOverride] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);

  const invoiceTitle = titleOverride ?? me.data?.user?.name ?? "";
  const invoiceCompany = companyOverride ?? me.data?.user?.company ?? "";

  // سبد خالی در گام ۱ → بازگشت به صفحه سبد خرید (مگر آنکه سفارش قبلاً ثبت شده باشد).
  const liveItems = cart.data?.items ?? [];
  useEffect(() => {
    if (cart.data && cart.data.items.length === 0 && step === 1 && !createdOrder) {
      router.replace(routes.portalCart);
    }
  }, [cart.data, step, createdOrder, router]);

  // منبع خلاصه سفارش: پس از ثبت سفارش، Snapshot سفارش (اعداد نهایی سرور) جای سبد زنده را می‌گیرد.
  const summaryLines: SummaryLine[] = createdOrder
    ? createdOrder.items.map((it, i) => ({
        key: `${it.snapshot.quoteId}-${i}`,
        name: it.packageNameFa,
        months: it.input.months,
        users: it.input.users,
        endpoints: it.input.endpoints,
        total: it.totalToman,
      }))
    : liveItems.map((it) => ({
        key: it.id,
        name: it.quote.breakdown?.packageNameFa ?? it.input.packageCode,
        months: it.input.months,
        users: it.input.users,
        endpoints: it.input.endpoints,
        total: it.quote.breakdown?.totalToman ?? 0,
      }));
  const summaryTotal = createdOrder ? createdOrder.totalToman : (cart.data?.totalToman ?? 0);
  const hasSummary = summaryLines.length > 0;

  function go(next: Step) {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  }

  function validateTitle(): boolean {
    const t = invoiceTitle.trim();
    if (t.length === 0) {
      setTitleError("عنوان گیرنده فاکتور الزامی است.");
      return false;
    }
    if (t.length < 2) {
      setTitleError("عنوان گیرنده باید حداقل ۲ نویسه باشد.");
      return false;
    }
    setTitleError(null);
    return true;
  }

  async function handlePay() {
    if (!createdOrder && liveItems.length === 0) return;
    if (!validateTitle()) {
      go(2);
      return;
    }
    setPaying(true);
    try {
      let order = createdOrder;
      if (!order) {
        const res = await checkout.mutateAsync({
          invoiceTitle: invoiceTitle.trim(),
          invoiceCompany: invoiceCompany.trim() || undefined,
        });
        order = res.order;
        setCreatedOrder(order);
      }
      try {
        const init = await initPayment.mutateAsync({ orderId: order.id, gateway: gatewayId });
        // انتقال کامل صفحه به درگاه پرداخت واقعی (صفحه Sandbox زرین‌پال / زیبال).
        window.location.href = init.gatewayUrl;
      } catch (e) {
        toast.error(errorMessage(e));
        setPaying(false);
      }
    } catch (e) {
      toast.error(errorMessage(e));
      setPaying(false);
    }
  }

  const slideX = direction >= 0 ? 24 : -24;

  return (
    <>
      <PageHeader
        title="تسویه حساب"
        description="ثبت نهایی سفارش و انتقال به درگاه پرداخت؛ اعتبارسنجی مبلغ همیشه سمت سرور انجام می‌شود."
        breadcrumbs={[
          { label: "پنل کاربری", to: routes.portal },
          { label: "سبد خرید", to: routes.portalCart },
          { label: "تسویه حساب" },
        ]}
      />

      <Reveal className="rounded-xl border bg-card p-4">
        <StepIndicator current={step} />
      </Reveal>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* محتوای گام‌ها */}
        <div className="min-w-0 lg:col-span-2">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: -slideX }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slideX }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {step === 1 ? (
                /* ---------------- گام ۱: مرور سفارش ---------------- */
                createdOrder ? (
                  <div className="rounded-xl border border-info/30 bg-info/10 p-6 text-center">
                    <ReceiptText className="mx-auto size-10 text-info" />
                    <h3 className="mt-3 text-sm font-extrabold">سفارش شما ثبت شده است</h3>
                    <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                      سبد خرید این سفارش مصرف شده است. برای تکمیل پرداخت به گام پرداخت بروید.
                    </p>
                    <p className="ltr-iso mt-2 font-mono text-xs font-bold text-foreground" dir="ltr">
                      {createdOrder.orderNumber}
                    </p>
                    <Button className="mt-4" onClick={() => go(3)}>
                      <CreditCard className="size-4" />
                      ادامه تا پرداخت
                    </Button>
                  </div>
                ) : cart.isError ? (
                  <ErrorState message="دریافت سبد خرید انجام نشد." onRetry={() => cart.refetch()} />
                ) : cart.isLoading && liveItems.length === 0 ? (
                  <SkeletonRows rows={3} />
                ) : liveItems.length === 0 ? (
                  <FullPageLoader label="در حال انتقال به سبد خرید…" />
                ) : (
                  <div className="space-y-4">
                    {liveItems.map((item) => (
                      <ReviewItemCard key={item.id} item={item} />
                    ))}
                    <div className="flex justify-end">
                      <Button onClick={() => go(2)}>
                        تأیید و ادامه
                        <ArrowLeft className="size-4" />
                      </Button>
                    </div>
                  </div>
                )
              ) : step === 2 ? (
                /* ---------------- گام ۲: اطلاعات گیرنده فاکتور ---------------- */
                <div className="rounded-xl border bg-card p-5">
                  <h3 className="flex items-center gap-2 text-sm font-extrabold">
                    <ReceiptText className="size-4 text-primary" />
                    اطلاعات گیرنده فاکتور
                  </h3>
                  <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                    این اطلاعات روی فاکتور رسمی درج می‌شود و پس از ثبت سفارش قابل ویرایش نخواهد بود.
                  </p>

                  <div className="mt-5 space-y-4">
                    <FormField
                      label="عنوان گیرنده"
                      htmlFor="invoice-title"
                      required
                      error={titleError}
                      hint="پیشنهاد: نام شخص حقیقی یا حقوقی (حداقل ۲ نویسه)"
                    >
                      <TextField
                        id="invoice-title"
                        value={invoiceTitle}
                        onChange={(e) => {
                          setTitleOverride(e.target.value);
                          if (titleError) setTitleError(null);
                        }}
                        onBlur={validateTitle}
                        invalid={!!titleError}
                        placeholder="مثال: شرکت فناوران داده Orbit"
                        autoComplete="name"
                      />
                    </FormField>

                    <FormField
                      label="نام شرکت"
                      htmlFor="invoice-company"
                      hint="اختیاری — در صورت وجود شخصیت حقوقی وارد کنید."
                    >
                      <TextField
                        id="invoice-company"
                        value={invoiceCompany}
                        onChange={(e) => setCompanyOverride(e.target.value)}
                        placeholder="مثال: Orbit Data Co."
                        autoComplete="organization"
                      />
                    </FormField>
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                    <Button variant="outline" onClick={() => go(1)}>
                      <ArrowRight className="size-4" />
                      بازگشت
                    </Button>
                    <Button
                      onClick={() => {
                        if (validateTitle()) go(3);
                      }}
                    >
                      ادامه
                      <ArrowLeft className="size-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                /* ---------------- گام ۳: تأیید و پرداخت ---------------- */
                <div className="space-y-5">
                  <div className="rounded-xl border bg-card p-5">
                    <h3 className="flex items-center gap-2 text-sm font-extrabold">
                      <Check className="size-4 text-success" />
                      تأیید نهایی سفارش
                    </h3>
                    {createdOrder ? (
                      <p className="mt-3 text-xs leading-6">
                        سفارش{" "}
                        <span className="ltr-iso font-mono font-bold" dir="ltr">
                          {createdOrder.orderNumber}
                        </span>{" "}
                        با وضعیت «در انتظار پرداخت» ثبت شده است؛ با دکمه پایین به درگاه منتقل می‌شوید.
                      </p>
                    ) : (
                      <ul className="mt-3 space-y-2.5 text-xs">
                        {liveItems.map((item) => (
                          <li
                            key={item.id}
                            className="flex items-start justify-between gap-3 border-b border-border/60 pb-2.5 last:border-0 last:pb-0"
                          >
                            <div className="min-w-0">
                              <p className="font-bold">
                                {item.quote.breakdown?.packageNameFa ?? item.input.packageCode}
                              </p>
                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                مدت {toFaDigits(item.input.months)} ماه · {toFaDigits(item.input.users)}{" "}
                                کاربر · {toFaDigits(item.input.endpoints)} Endpoint
                              </p>
                            </div>
                            <PriceTag
                              toman={item.quote.breakdown?.totalToman ?? 0}
                              className="shrink-0 font-bold"
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/50 p-3">
                      <span className="text-xs font-extrabold">مبلغ قابل پرداخت</span>
                      <PriceTag toman={summaryTotal} className="text-sm font-extrabold text-primary" />
                    </div>
                    <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                      گیرنده فاکتور: {" "}
                      <span className="font-bold text-foreground">{invoiceTitle.trim()}</span>
                      {invoiceCompany.trim() ? (
                        <>
                          {" "}
                          — <span className="font-bold text-foreground">{invoiceCompany.trim()}</span>
                        </>
                      ) : null}
                    </p>
                  </div>

                  <div className="rounded-xl border bg-card p-5">
                    <h3 className="text-sm font-extrabold">روش پرداخت</h3>
                    {gateways.isLoading ? (
                      <div className="mt-4 space-y-2.5" aria-busy="true">
                        <div className="h-16 animate-pulse rounded-xl bg-muted/60" />
                        <div className="h-16 animate-pulse rounded-xl bg-muted/60" />
                      </div>
                    ) : available.length === 0 ? (
                      <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-[11px] leading-5 text-destructive">
                        درگاه پرداخت فعالی در دسترس نیست؛ لطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید.
                      </p>
                    ) : (
                      <RadioGroup
                        value={effectiveGatewayId}
                        onValueChange={setGatewayId}
                        className="mt-4 gap-2.5"
                        aria-label="انتخاب درگاه پرداخت"
                      >
                        {available.map((g) => (
                          <label
                            key={g.gateway}
                            htmlFor={`pm-${g.gateway}`}
                            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                              effectiveGatewayId === g.gateway ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                            }`}
                          >
                            <RadioGroupItem value={g.gateway} id={`pm-${g.gateway}`} className="mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-extrabold">{g.labelFa}</span>
                                <StatusBadge
                                  status={g.mode === "sandbox" || g.mode === "test" ? "active" : "pending"}
                                  label={g.mode === "sandbox" ? "Sandbox" : g.mode === "test" ? "آزمایشی" : "—"}
                                />
                              </div>
                              <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{g.noteFa}</p>
                            </div>
                          </label>
                        ))}
                      </RadioGroup>
                    )}

                    <div className="mt-2.5 space-y-2">
                      <div
                        className="flex items-center justify-between gap-3 rounded-xl border bg-muted/40 p-4 opacity-70"
                        aria-disabled="true"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className="size-4 shrink-0 rounded-full border border-border bg-background"
                            aria-hidden="true"
                          />
                          <span className="text-sm font-bold text-muted-foreground">به‌پرداخت ملت</span>
                        </div>
                        <StatusBadge status="not_configured" label="غیرفعال" />
                      </div>
                    </div>

                    <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                      نتیجه پرداخت صرفاً از طریق استعلام سمت سرور با درگاه انتخابی تأیید می‌شود؛ پس از پرداخت به
                      صفحه نتیجه بازمی‌گردید.
                    </p>
                  </div>

                  <div className="rounded-xl border bg-card p-5">
                    <Button
                      size="lg"
                      className="w-full"
                      disabled={paying || (!createdOrder && liveItems.length === 0)}
                      onClick={handlePay}
                    >
                      {paying ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                      پرداخت و ثبت نهایی سفارش
                    </Button>
                    {paying ? (
                      <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
                        در حال ثبت سفارش و انتقال به درگاه… لطفاً صفحه را نبندید.
                      </p>
                    ) : (
                      <p className="mt-3 flex items-start justify-center gap-1.5 text-center text-[11px] leading-5 text-muted-foreground">
                        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
                        پیش از انتقال به درگاه، صحت مبلغ مجدداً سمت سرور اعتبارسنجی می‌شود.
                      </p>
                    )}
                    {!createdOrder ? (
                      <Button
                        variant="ghost"
                        className="mt-2 w-full"
                        onClick={() => go(2)}
                        disabled={paying}
                      >
                        <ArrowRight className="size-4" />
                        بازگشت به اطلاعات فاکتور
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* خلاصه چسبان — در تمام گام‌ها ثابت است */}
        <Reveal delay={0.08} className="self-start lg:sticky lg:top-24">
          <aside className="space-y-4 rounded-xl border bg-card p-5">
            <h3 className="text-sm font-extrabold">خلاصه سفارش</h3>
            {hasSummary ? (
              <>
                <ul className="space-y-3">
                  {summaryLines.map((line) => (
                    <li
                      key={line.key}
                      className="flex items-start justify-between gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold">{line.name}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          مدت {toFaDigits(line.months)} ماه · {toFaDigits(line.users)} کاربر · {" "}
                          {toFaDigits(line.endpoints)} Endpoint
                        </p>
                      </div>
                      <PriceTag toman={line.total} className="shrink-0 text-xs font-bold" />
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between border-t pt-3.5">
                  <span className="text-xs font-bold">جمع کل</span>
                  <PriceTag toman={summaryTotal} className="text-sm font-extrabold text-primary" />
                </div>
              </>
            ) : (
              <SkeletonRows rows={3} />
            )}
            <div className="flex items-start gap-2 rounded-lg border border-info/25 bg-info/10 p-3 text-[11px] leading-5 text-info">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                تخفیف مدت قرارداد داخل هر قلم اعمال شده است؛ طبق تعرفه رسمی، کد تخفیف جداگانه وجود
                ندارد.
              </span>
            </div>
          </aside>
        </Reveal>
      </div>
    </>
  );
}
