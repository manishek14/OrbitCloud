"use client";

// سبد خرید مشتری — اقلام پکیج همراه با استعلام قیمت سمت سرور (Quote Snapshot).
// همه مبالغ صرفاً از پاسخ سرور نمایش داده می‌شوند؛ هیچ محاسبه‌ای سمت کلاینت انجام نمی‌شود.

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  CreditCard,
  Info,
  Loader2,
  PackageOpen,
  Plus,
  RefreshCcw,
  ShieldCheck,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useCart, useRemoveCartItem } from "@/lib/api/hooks";
import { errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PriceTag,
  SkeletonRows,
} from "@/components/abrit/ui";
import { ConfirmDialog } from "@/components/abrit/confirm-dialog";
import { Reveal } from "@/components/abrit/motion";
import { formatToman, toFaDigits } from "@/lib/format/fa";
import type { CartItemDTO } from "@/lib/api/types";

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

function CartItemCard({
  item,
  onRemove,
  removing,
}: {
  item: CartItemDTO;
  onRemove: () => void;
  removing: boolean;
}) {
  const quote = item.quote;
  const breakdown = quote.breakdown;
  return (
    <article className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold">
            {breakdown?.packageNameFa ?? item.input.packageCode}
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip>مدت {toFaDigits(item.input.months)} ماه</Chip>
            <Chip>{toFaDigits(item.input.users)} کاربر</Chip>
            <Chip>{toFaDigits(item.input.endpoints)} Endpoint</Chip>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRemove}
          disabled={removing}
          className="shrink-0 text-destructive hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          aria-label="حذف این قلم از سبد"
        >
          {removing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          حذف
        </Button>
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
          استعلام این قلم معتبر نیست؛ آن را حذف کرده و با پیکربندی جدید دوباره به سبد اضافه کنید.
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

export default function CartView() {
  const router = useRouter();
  const cart = useCart();
  const removeItem = useRemoveCartItem();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const data = cart.data;

  return (
    <>
      <PageHeader
        title="سبد خرید"
        description="اقلام انتخابی شما با استعلام لحظه‌ای قیمت از سرور؛ مبالغ همیشه سمت سرور محاسبه و اعتبارسنجی می‌شوند."
        breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "سبد خرید" }]}
        actions={
          <Button variant="outline" size="sm" onClick={() => cart.refetch()} disabled={cart.isFetching}>
            <RefreshCcw className={cart.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
            به‌روزرسانی
          </Button>
        }
      />

      {cart.isError ? (
        <ErrorState message="دریافت سبد خرید انجام نشد." onRetry={() => cart.refetch()} />
      ) : cart.isLoading ? (
        <SkeletonRows rows={4} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="size-6" />}
          title="سبد خرید شما خالی است"
          description="پکیج مناسب کسب‌وکار خود را از صفحه پلن‌ها و تعرفه پیکربندی کنید و به سبد اضافه کنید."
          action={
            <Button onClick={() => router.navigate(routes.portalPlans)}>
              <PackageOpen className="size-4" />
              مشاهده پلن‌ها و تعرفه
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* آیتم‌ها */}
          <Reveal className="space-y-4 lg:col-span-2">
            {data.items.map((item) => (
              <CartItemCard
                key={item.id}
                item={item}
                removing={removeItem.isPending && confirmId === item.id}
                onRemove={() => setConfirmId(item.id)}
              />
            ))}
          </Reveal>

          {/* خلاصه سفارش — چسبان در دسکتاپ */}
          <Reveal delay={0.08} className="self-start lg:sticky lg:top-24">
            <aside className="space-y-4 rounded-xl border bg-card p-5">
              <h3 className="flex items-center gap-2 text-sm font-extrabold">
                <ShoppingCart className="size-4 text-primary" />
                خلاصه سفارش
              </h3>

              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">تعداد اقلام</span>
                <span className="font-bold tabular-nums">{toFaDigits(data.count)}</span>
              </div>

              <div className="flex items-center justify-between gap-3 border-t pt-3.5">
                <span className="text-xs font-bold">جمع کل (محاسبه سرور)</span>
                <PriceTag toman={data.totalToman} className="text-base font-extrabold text-primary" />
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-info/25 bg-info/10 p-3 text-[11px] leading-5 text-info">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  تخفیف مدت قرارداد داخل هر قلم اعمال شده است؛ طبق تعرفه رسمی، کد تخفیف جداگانه وجود
                  ندارد.
                </span>
              </div>

              <p className="flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
                محاسبه نهایی پیش از پرداخت مجدداً سمت سرور انجام می‌شود.
              </p>

              <div className="grid gap-2 border-t pt-4">
                <Button variant="outline" onClick={() => router.navigate(routes.portalPlans)}>
                  <Plus className="size-3.5" />
                  ادامه خرید
                </Button>
                <Button
                  onClick={() => router.navigate(routes.portalCheckout)}
                  disabled={data.items.length === 0}
                >
                  <CreditCard className="size-3.5" />
                  تکمیل خرید و تسویه
                </Button>
              </div>
            </aside>
          </Reveal>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmId}
        onOpenChange={(open) => {
          if (!open) setConfirmId(null);
        }}
        title="حذف قلم از سبد خرید"
        description="این قلم از سبد خرید شما حذف می‌شود. برای بازگرداندن آن باید پکیج را دوباره پیکربندی و اضافه کنید."
        confirmLabel="حذف قلم"
        destructive
        pending={removeItem.isPending}
        onConfirm={() => {
          if (!confirmId) return;
          removeItem.mutate(confirmId, {
            onSuccess: () => {
              toast.success("قلم از سبد خرید حذف شد.");
              setConfirmId(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          });
        }}
      />
    </>
  );
}
