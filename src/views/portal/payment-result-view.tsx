"use client";

// نتیجه پرداخت — وضعیت این صفحه تنها از تأیید سمت سرور (/api/payments/result) به دست
// می‌آید؛ تا زمان pending به‌صورت خودکار poll می‌شود و هیچ وضعیتی سمت کلاینت «حدس» زده نمی‌شود.

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  LayoutDashboard,
  Loader2,
  Receipt,
  RefreshCcw,
  XCircle,
} from "lucide-react";
import { Link, useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useInitPayment, usePaymentResult } from "@/lib/api/hooks";
import { errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ErrorState,
  FullPageLoader,
  PageHeader,
  PriceTag,
} from "@/components/abrit/ui";
import { Reveal } from "@/components/abrit/motion";
import type { PaymentResultDTO } from "@/lib/api/types";

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-end">{value}</span>
    </div>
  );
}

function ResultShell({ children }: { children: ReactNode }) {
  return (
    <Reveal className="mx-auto w-full max-w-xl">
      <div className="rounded-2xl border bg-card p-6 sm:p-8">{children}</div>
    </Reveal>
  );
}

export default function PaymentResultView() {
  const router = useRouter();
  const ref = router.query.ref ?? null;
  const result = usePaymentResult(ref);
  const initPayment = useInitPayment();
  const [retrying, setRetrying] = useState(false);

  // بدون مرجع تراکنش، این صفحه معنا ندارد.
  useEffect(() => {
    if (!ref) router.replace(routes.portalOrders);
  }, [ref, router]);

  async function retryPayment() {
    const orderId = result.data?.order?.id;
    if (!orderId) return;
    setRetrying(true);
    try {
      const init = await initPayment.mutateAsync({ orderId });
      // انتقال کامل صفحه به درگاه آزمایشی.
      window.location.href = init.gatewayUrl;
    } catch (e) {
      toast.error(errorMessage(e));
      setRetrying(false);
    }
  }

  if (!ref) {
    return <FullPageLoader label="در حال انتقال به سفارش‌ها…" />;
  }

  const header = (
    <PageHeader
      title="نتیجه پرداخت"
      description="وضعیت این صفحه تنها از تأیید سمت سرور درگاه به دست آمده است."
      breadcrumbs={[
        { label: "پنل کاربری", to: routes.portal },
        { label: "سفارش‌ها", to: routes.portalOrders },
        { label: "نتیجه پرداخت" },
      ]}
      actions={
        <Button variant="outline" size="sm" onClick={() => result.refetch()} disabled={result.isFetching}>
          <RefreshCcw className={result.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
          به‌روزرسانی
        </Button>
      }
    />
  );

  if (result.isLoading && !result.data) {
    return (
      <>
        {header}
        <ResultShell>
          <div className="space-y-3">
            <Skeleton className="mx-auto size-14 rounded-full" />
            <Skeleton className="mx-auto h-5 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-9 w-full" />
          </div>
        </ResultShell>
      </>
    );
  }

  if (result.isError || !result.data) {
    return (
      <>
        {header}
        <ErrorState
          message="دریافت نتیجه پرداخت از سرور انجام نشد."
          onRetry={() => result.refetch()}
        />
      </>
    );
  }

  const r: PaymentResultDTO = result.data;
  const canRetry = !!r.order && r.status !== "succeeded";

  return (
    <>
      {header}

      {r.status === "succeeded" ? (
        <ResultShell>
          <div className="flex flex-col items-center text-center">
            <CheckCircle2 className="size-16 text-success" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-extrabold">پرداخت با موفقیت تأیید شد</h2>
            <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
              سفارش شما پرداخت و فاکتور آن صادر شد؛ سرویس‌های مرتبط پس از راه‌اندازی فعال می‌شوند.
            </p>
          </div>

          <div className="mt-6 space-y-3 rounded-xl border bg-background/60 p-4">
            <InfoRow label="مبلغ پرداختی" value={<PriceTag toman={r.amountToman} className="font-extrabold" />} />
            <InfoRow
              label="شماره سفارش"
              value={
                r.order ? (
                  <Link
                    to={routes.portalOrders}
                    className="ltr-iso font-bold text-primary hover:underline"
                    dir="ltr"
                  >
                    {r.order.orderNumber}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <InfoRow
              label="شماره فاکتور"
              value={
                r.invoice ? (
                  <Link
                    to={routes.portalBilling}
                    className="ltr-iso font-bold text-primary hover:underline"
                    dir="ltr"
                  >
                    {r.invoice.number}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <InfoRow
              label="مرجع تراکنش"
              value={
                <span className="ltr-iso text-[11px] text-muted-foreground" dir="ltr">
                  {r.ref}
                </span>
              }
            />
          </div>

          <p className="mt-4 text-center text-[11px] leading-5 text-muted-foreground">
            وضعیت این صفحه تنها از تأیید سمت سرور درگاه به دست آمده است.
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button onClick={() => router.navigate(routes.portalBilling)}>
              <Receipt className="size-4" />
              مشاهده فاکتورها
            </Button>
            <Button variant="outline" onClick={() => router.navigate(routes.portal)}>
              <LayoutDashboard className="size-4" />
              بازگشت به داشبورد
            </Button>
          </div>
        </ResultShell>
      ) : r.status === "failed" ? (
        <ResultShell>
          <div className="flex flex-col items-center text-center">
            <XCircle className="size-16 text-destructive" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-extrabold">پرداخت ناموفق بود</h2>
            <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
              مبلغی از حساب شما کسر نشده است. می‌توانید پرداخت را برای همین سفارش مجدداً آغاز کنید.
            </p>
          </div>
          <div className="mt-6 space-y-3 rounded-xl border bg-background/60 p-4">
            <InfoRow label="مبلغ" value={<PriceTag toman={r.amountToman} />} />
            <InfoRow
              label="شماره سفارش"
              value={
                r.order ? (
                  <span className="ltr-iso font-bold" dir="ltr">
                    {r.order.orderNumber}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <InfoRow
              label="مرجع تراکنش"
              value={
                <span className="ltr-iso text-[11px] text-muted-foreground" dir="ltr">
                  {r.ref}
                </span>
              }
            />
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {canRetry ? (
              <Button onClick={retryPayment} disabled={retrying}>
                {retrying ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
                پرداخت مجدد
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => router.navigate(routes.portalOrders)}>
              مشاهده سفارش‌ها
            </Button>
          </div>
        </ResultShell>
      ) : r.status === "cancelled" ? (
        <ResultShell>
          <div className="flex flex-col items-center text-center">
            <Ban className="size-16 text-muted-foreground" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-extrabold">پرداخت لغو شد</h2>
            <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
              شما پرداخت را در درگاه لغو کردید. سفارش همچنان «در انتظار پرداخت» است و می‌توانید ادامه دهید.
            </p>
          </div>
          <div className="mt-6 space-y-3 rounded-xl border bg-background/60 p-4">
            <InfoRow label="مبلغ" value={<PriceTag toman={r.amountToman} />} />
            <InfoRow
              label="شماره سفارش"
              value={
                r.order ? (
                  <span className="ltr-iso font-bold" dir="ltr">
                    {r.order.orderNumber}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <InfoRow
              label="مرجع تراکنش"
              value={
                <span className="ltr-iso text-[11px] text-muted-foreground" dir="ltr">
                  {r.ref}
                </span>
              }
            />
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {canRetry ? (
              <Button onClick={retryPayment} disabled={retrying}>
                {retrying ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
                پرداخت مجدد
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => router.navigate(routes.portalOrders)}>
              مشاهده سفارش‌ها
            </Button>
          </div>
        </ResultShell>
      ) : (
        <ResultShell>
          <div className="flex flex-col items-center py-6 text-center">
            <span className="relative flex size-10">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/25" />
              <Loader2 className="relative size-10 animate-spin text-primary" />
            </span>
            <h2 className="mt-5 text-sm font-extrabold">در انتظار تأیید نتیجه پرداخت از درگاه…</h2>
            <p className="mt-1.5 max-w-sm text-xs leading-6 text-muted-foreground">
              این صفحه به‌صورت خودکار هر چند ثانیه یک‌بار به‌روزرسانی می‌شود؛ نیازی به بازدید مجدد نیست.
            </p>
            <div className="mt-5 w-full space-y-3 rounded-xl border bg-background/60 p-4">
              <InfoRow label="مبلغ" value={<PriceTag toman={r.amountToman} />} />
              <InfoRow
                label="مرجع تراکنش"
                value={
                  <span className="ltr-iso text-[11px] text-muted-foreground" dir="ltr">
                    {r.ref}
                  </span>
                }
              />
            </div>
          </div>
        </ResultShell>
      )}
    </>
  );
}
