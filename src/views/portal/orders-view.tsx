"use client";

// سفارش‌های مشتری — فهرست با وضعیت‌ها، جزئیات کامل هر سفارش (Snapshot اقلام)،
// پرداخت سفارش‌های در انتظار (انتقال به درگاه) و لغو سفارش.

import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  PackageOpen,
  Receipt,
} from "lucide-react";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useCancelOrder, useInitPayment, useOrder, useOrders } from "@/lib/api/hooks";
import { errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PriceTag,
  SkeletonRows,
  StatusBadge,
} from "@/components/abrit/ui";
import { DataTable, type Column } from "@/components/abrit/data-table";
import { ConfirmDialog } from "@/components/abrit/confirm-dialog";
import { Reveal } from "@/components/abrit/motion";
import { formatDateTime, formatToman, toFaDigits } from "@/lib/format/fa";
import type { OrderListEntryDTO } from "@/lib/api/types";

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
      {children}
    </span>
  );
}

function StatChip({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-xs font-bold shadow-sm">
      <span className={tone}>{icon}</span>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{toFaDigits(value)}</span>
    </span>
  );
}

const columns: Column<OrderListEntryDTO>[] = [
  {
    key: "orderNumber",
    header: "شماره سفارش",
    cell: (row) => (
      <span className="ltr-iso font-bold" dir="ltr">
        {row.orderNumber}
      </span>
    ),
  },
  { key: "status", header: "وضعیت", cell: (row) => <StatusBadge status={row.status} /> },
  {
    key: "itemCount",
    header: "اقلام",
    cell: (row) => <span className="tabular-nums">{toFaDigits(row.itemCount)}</span>,
  },
  {
    key: "total",
    header: "مبلغ",
    cell: (row) => <PriceTag toman={row.totalToman} className="text-xs font-bold" />,
  },
  {
    key: "createdAt",
    header: "تاریخ ثبت",
    cell: (row) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span>
    ),
  },
  {
    key: "paidAt",
    header: "تاریخ پرداخت",
    cell: (row) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {row.paidAt ? formatDateTime(row.paidAt) : "—"}
      </span>
    ),
  },
];

export default function OrdersView() {
  const router = useRouter();
  const orders = useOrders();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const orderDetail = useOrder(selectedId);
  const cancelOrder = useCancelOrder();
  const initPayment = useInitPayment();
  const queryClient = useQueryClient();
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);

  const all = orders.data ?? [];
  const pendingCount = all.filter((o) => o.status === "pending_payment").length;
  const paidCount = all.filter((o) => o.status === "paid").length;

  async function payOrder(orderId: string) {
    setPayingId(orderId);
    try {
      const init = await initPayment.mutateAsync({ orderId });
      // انتقال کامل صفحه به درگاه پرداخت آزمایشی.
      window.location.href = init.gatewayUrl;
    } catch (e) {
      toast.error(errorMessage(e));
      setPayingId(null);
    }
  }

  function cancel(orderId: string) {
    cancelOrder.mutate(orderId, {
      onSuccess: () => {
        toast.success("سفارش لغو شد.");
        setCancelConfirm(false);
        setSelectedId(null);
        void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  }

  const detail = orderDetail.data;

  return (
    <>
      <PageHeader
        title="سفارش‌ها"
        description="سفارش‌های پکیج سازمانی شما؛ جزئیات، وضعیت پرداخت و اقدام‌های هر سفارش."
        breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "سفارش‌ها" }]}
      />

      {orders.isError ? (
        <ErrorState message="دریافت فهرست سفارش‌ها انجام نشد." onRetry={() => orders.refetch()} />
      ) : orders.isLoading ? (
        <SkeletonRows rows={5} />
      ) : all.length === 0 ? (
        <EmptyState
          icon={<Receipt className="size-6" />}
          title="هنوز سفارشی ثبت نکرده‌اید"
          description="پکیج مناسب کسب‌وکار خود را انتخاب، پیکربندی و سفارش دهید."
          action={
            <Button onClick={() => router.navigate(routes.portalPlans)}>
              <PackageOpen className="size-4" />
              مشاهده پلن‌ها و تعرفه
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <Reveal className="flex flex-wrap gap-2">
            <StatChip icon={<Receipt className="size-3.5" />} label="کل سفارش‌ها" value={all.length} />
            <StatChip
              icon={<Clock className="size-3.5" />}
              label="در انتظار پرداخت"
              value={pendingCount}
              tone="text-warning"
            />
            <StatChip
              icon={<CheckCircle2 className="size-3.5" />}
              label="پرداخت شده"
              value={paidCount}
              tone="text-success"
            />
          </Reveal>

          <Reveal delay={0.06}>
            <DataTable
              columns={columns}
              rows={all}
              rowKey={(row) => row.id}
              onRowClick={(row) => setSelectedId(row.id)}
              emptyTitle="سفارشی یافت نشد"
              mobileCard={(row) => (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="ltr-iso text-sm font-extrabold" dir="ltr">
                      {row.orderNumber}
                    </span>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>ثبت: {formatDateTime(row.createdAt)}</span>
                    <span className="tabular-nums">{toFaDigits(row.itemCount)} قلم</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">مبلغ</span>
                    <PriceTag toman={row.totalToman} className="text-xs font-bold" />
                  </div>
                </div>
              )}
            />
          </Reveal>
        </div>
      )}

      {/* جزئیات سفارش */}
      <Dialog
        open={!!selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent
          dir="rtl"
          className="max-h-[85vh] overflow-y-auto scrollbar-slim sm:max-w-2xl"
        >
          {orderDetail.isLoading && !detail ? (
            <SkeletonRows rows={6} />
          ) : orderDetail.isError || !detail ? (
            <ErrorState
              message="دریافت جزئیات سفارش انجام نشد."
              onRetry={() => orderDetail.refetch()}
            />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2.5 ltr-iso" dir="rtl">
                  <span dir="ltr">جزئیات سفارش {detail.orderNumber}</span>
                  <StatusBadge status={detail.status} />
                </DialogTitle>
                <DialogDescription>
                  ثبت‌شده در {formatDateTime(detail.createdAt)}
                  {detail.paidAt ? ` — پرداخت‌شده در ${formatDateTime(detail.paidAt)}` : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2.5 rounded-xl border bg-background/60 p-4 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">گیرنده فاکتور</span>
                  <span className="font-bold">{detail.invoiceTitle}</span>
                </div>
                {detail.invoiceCompany ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">نام شرکت</span>
                    <span className="font-bold">{detail.invoiceCompany}</span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">تعداد اقلام</span>
                  <span className="tabular-nums font-bold">{toFaDigits(detail.itemCount)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t pt-2.5">
                  <span className="font-bold">مبلغ کل سفارش</span>
                  <PriceTag toman={detail.totalToman} className="text-sm font-extrabold text-primary" />
                </div>
              </div>

              <div className="space-y-3">
                {detail.items.map((item, idx) => (
                  <article key={`${item.snapshot.quoteId}-${idx}`} className="rounded-xl border bg-card p-4">
                    <h4 className="text-xs font-extrabold">{item.packageNameFa}</h4>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Chip>مدت {toFaDigits(item.input.months)} ماه</Chip>
                      <Chip>{toFaDigits(item.input.users)} کاربر</Chip>
                      <Chip>{toFaDigits(item.input.endpoints)} Endpoint</Chip>
                    </div>
                    <ul className="mt-3 space-y-2 border-t pt-2.5">
                      {item.lineItems.map((line) => (
                        <li key={line.key} className="flex items-start justify-between gap-3 text-[11px]">
                          <div className="min-w-0">
                            <p className="font-semibold leading-5">{line.labelFa}</p>
                            {line.noteFa ? (
                              <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                                {line.noteFa}
                              </p>
                            ) : null}
                          </div>
                          {line.amountToman < 0 ? (
                            <span className="shrink-0 font-bold tabular-nums text-success">
                              −{formatToman(Math.abs(line.amountToman))} تومان
                            </span>
                          ) : line.amountToman === 0 ? (
                            <span className="shrink-0 text-muted-foreground">بدون هزینه</span>
                          ) : (
                            <span className="shrink-0 tabular-nums">
                              {formatToman(line.amountToman)}{" "}
                              <span className="text-[10px] text-muted-foreground">تومان</span>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2.5 flex items-center justify-between border-t pt-2.5">
                      <span className="text-[11px] font-bold text-muted-foreground">جمع این قلم</span>
                      <PriceTag toman={item.totalToman} className="text-xs font-extrabold" />
                    </div>
                    <p className="ltr-iso mt-2 font-mono text-[9px] text-muted-foreground/70" dir="ltr">
                      quote: {item.snapshot.quoteId}
                    </p>
                  </article>
                ))}
              </div>

              {detail.status === "pending_payment" ? (
                <DialogFooter className="border-t pt-4 sm:flex-row sm:justify-start">
                  <Button onClick={() => payOrder(detail.id)} disabled={payingId === detail.id}>
                    {payingId === detail.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CreditCard className="size-4" />
                    )}
                    پرداخت
                  </Button>
                  <Button
                    variant="outline"
                    className="text-destructive hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setCancelConfirm(true)}
                    disabled={cancelOrder.isPending}
                  >
                    {cancelOrder.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Ban className="size-4" />
                    )}
                    لغو سفارش
                  </Button>
                </DialogFooter>
              ) : null}
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelConfirm}
        onOpenChange={(open) => {
          if (!open) setCancelConfirm(false);
        }}
        title="لغو سفارش"
        description="سفارش در وضعیت «در انتظار پرداخت» لغو می‌شود و امکان بازگشت آن وجود ندارد. آیا مطمئن هستید؟"
        confirmLabel="لغو سفارش"
        destructive
        pending={cancelOrder.isPending}
        onConfirm={() => {
          if (selectedId) cancel(selectedId);
        }}
      />
    </>
  );
}
