"use client";

// پرداخت‌ها و فاکتورها — دو تب: فاکتورها (با نمای چاپی) و تراکنش‌ها (نتیجه‌گیری
// صرفاً از طریق کال‌بک درگاه).

import { useState, type ReactNode } from "react";
import {
  FileText,
  Info,
  Landmark,
  PackageOpen,
  Printer,
  Receipt,
  RefreshCcw,
} from "lucide-react";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useInvoices, useTransactions } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Logo,
  PageHeader,
  PriceTag,
  StatusBadge,
} from "@/components/abrit/ui";
import { DataTable, type Column } from "@/components/abrit/data-table";
import { Reveal } from "@/components/abrit/motion";
import { formatDateTime, formatToman, toFaDigits } from "@/lib/format/fa";
import type { InvoiceDTO, TransactionDTO } from "@/lib/api/types";

/** برچسب وضعیت فاکتور — issued/void در StatusBadge مشترک تعریف نشده‌اند؛ اینجا نگاشت می‌شوند. */
function InvoiceStatusBadge({ status }: { status: InvoiceDTO["status"] }) {
  if (status === "paid") return <StatusBadge status="paid" />;
  if (status === "issued") return <StatusBadge status="pending" label="صادر شده" />;
  return <StatusBadge status="cancelled" label="باطل شده" />;
}

function gatewayLabel(gateway: string): string {
  if (gateway === "mock") return "درگاه آزمایشی";
  return gateway;
}

const invoiceColumns: Column<InvoiceDTO>[] = [
  {
    key: "number",
    header: "شماره فاکتور",
    cell: (row) => (
      <span className="ltr-iso font-bold" dir="ltr">
        {row.number}
      </span>
    ),
  },
  {
    key: "orderNumber",
    header: "سفارش مرتبط",
    cell: (row) => (
      <span className="ltr-iso text-xs text-muted-foreground" dir="ltr">
        {row.orderNumber}
      </span>
    ),
  },
  {
    key: "amount",
    header: "مبلغ",
    cell: (row) => <PriceTag toman={row.amountToman} className="text-xs font-bold" />,
  },
  { key: "status", header: "وضعیت", cell: (row) => <InvoiceStatusBadge status={row.status} /> },
  {
    key: "issuedAt",
    header: "تاریخ صدور",
    cell: (row) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(row.issuedAt)}</span>
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

const txColumns: Column<TransactionDTO>[] = [
  {
    key: "ref",
    header: "مرجع",
    cell: (row) => (
      <span className="ltr-iso text-xs font-bold" dir="ltr">
        {row.ref}
      </span>
    ),
  },
  {
    key: "orderNumber",
    header: "سفارش",
    cell: (row) => (
      <span className="ltr-iso text-xs text-muted-foreground" dir="ltr">
        {row.orderNumber}
      </span>
    ),
  },
  {
    key: "gateway",
    header: "درگاه",
    cell: (row) => <span className="text-xs">{gatewayLabel(row.gateway)}</span>,
  },
  {
    key: "amount",
    header: "مبلغ",
    cell: (row) => <PriceTag toman={row.amountToman} className="text-xs font-bold" />,
  },
  { key: "status", header: "وضعیت", cell: (row) => <StatusBadge status={row.status} /> },
  {
    key: "createdAt",
    header: "زمان",
    cell: (row) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span>
    ),
  },
  {
    key: "finalizedAt",
    header: "نتیجه‌گیری",
    cell: (row) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {row.finalizedAt ? formatDateTime(row.finalizedAt) : "—"}
      </span>
    ),
  },
];

/** نمای چاپی فاکتور داخل دیالوگ. */
function InvoicePrintable({ invoice }: { invoice: InvoiceDTO }) {
  return (
    <div className="rounded-xl border bg-card p-5" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <Logo />
        <div className="text-end">
          <p className="text-sm font-extrabold">فاکتور فروش خدمات</p>
          <p className="ltr-iso mt-1 text-xs text-muted-foreground" dir="ltr">
            {invoice.number}
          </p>
        </div>
      </div>

      <div className="grid gap-2 border-b py-4 text-xs sm:grid-cols-2">
        <p>
          <span className="text-muted-foreground">گیرنده: </span>
          <span className="font-bold">{invoice.title}</span>
        </p>
        {invoice.company ? (
          <p>
            <span className="text-muted-foreground">شرکت: </span>
            <span className="font-bold">{invoice.company}</span>
          </p>
        ) : null}
        <p>
          <span className="text-muted-foreground">سفارش مرتبط: </span>
          <span className="ltr-iso font-bold" dir="ltr">
            {invoice.orderNumber}
          </span>
        </p>
        <p>
          <span className="text-muted-foreground">تاریخ صدور: </span>
          <span className="font-bold">{formatDateTime(invoice.issuedAt)}</span>
        </p>
        {invoice.paidAt ? (
          <p>
            <span className="text-muted-foreground">تاریخ پرداخت: </span>
            <span className="font-bold">{formatDateTime(invoice.paidAt)}</span>
          </p>
        ) : null}
      </div>

      <div className="mt-4 overflow-x-auto scrollbar-slim">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50 text-[11px] text-muted-foreground">
              <th className="px-3 py-2.5 text-start font-bold">شرح</th>
              <th className="px-3 py-2.5 text-end font-bold">مبلغ (تومان)</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, i) => (
              <tr key={`${item.snapshot.quoteId}-${i}`} className="border-b border-border/60">
                <td className="px-3 py-2.5">
                  <p className="font-bold">{item.packageNameFa}</p>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                    مدت {toFaDigits(item.input.months)} ماه · {toFaDigits(item.input.users)} کاربر ·{" "}
                    {toFaDigits(item.input.endpoints)} Endpoint
                  </p>
                </td>
                <td className="px-3 py-2.5 text-end tabular-nums">{formatToman(item.totalToman)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/50 p-3">
        <span className="text-xs font-extrabold">جمع کل</span>
        <PriceTag toman={invoice.amountToman} className="text-sm font-extrabold" />
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">وضعیت فاکتور</span>
        <InvoiceStatusBadge status={invoice.status} />
      </div>

      <p className="mt-4 border-t pt-3 text-center text-[10px] leading-5 text-muted-foreground">
        این فاکتور به‌صورت الکترونیکی صادر شده است؛ مبالغ مطابق تعرفه رسمی ۱۴۰۵ و محاسبات سرور است.
      </p>
    </div>
  );
}

export default function BillingView() {
  const router = useRouter();
  const invoices = useInvoices();
  const transactions = useTransactions();
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDTO | null>(null);

  const invoiceList = invoices.data ?? [];
  const txList = transactions.data ?? [];

  return (
    <>
      <PageHeader
        title="پرداخت‌ها و فاکتورها"
        description="فاکتورهای صادرشده و تراکنش‌های درگاه پرداخت شما."
        breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "پرداخت‌ها و فاکتورها" }]}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void invoices.refetch();
              void transactions.refetch();
            }}
            disabled={invoices.isFetching || transactions.isFetching}
          >
            <RefreshCcw
              className={invoices.isFetching || transactions.isFetching ? "size-3.5 animate-spin" : "size-3.5"}
            />
            به‌روزرسانی
          </Button>
        }
      />

      <Reveal>
        <Tabs defaultValue="invoices" dir="rtl">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="invoices" className="flex-1 sm:flex-none">
              فاکتورها
            </TabsTrigger>
            <TabsTrigger value="transactions" className="flex-1 sm:flex-none">
              تراکنش‌ها
            </TabsTrigger>
          </TabsList>

          {/* ---------------- تب فاکتورها ---------------- */}
          <TabsContent value="invoices" className="mt-4">
            <DataTable
              columns={invoiceColumns}
              rows={invoiceList}
              rowKey={(row) => row.id}
              loading={invoices.isLoading}
              error={invoices.isError ? "دریافت فاکتورها انجام نشد." : null}
              onRetry={() => invoices.refetch()}
              emptyTitle="فاکتوری صادر نشده است"
              emptyDescription="پس از پرداخت موفق سفارش، فاکتور رسمی آن اینجا نمایش داده می‌شود."
              emptyAction={
                <Button size="sm" onClick={() => router.navigate(routes.portalPlans)}>
                  <PackageOpen className="size-3.5" />
                  خرید پلن جدید
                </Button>
              }
              onRowClick={(row) => setSelectedInvoice(row)}
              mobileCard={(row) => (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="ltr-iso text-sm font-extrabold" dir="ltr">
                      {row.number}
                    </span>
                    <InvoiceStatusBadge status={row.status} />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>صدور: {formatDateTime(row.issuedAt)}</span>
                    <span className="tabular-nums">{toFaDigits(invoiceList.indexOf(row) + 1)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">مبلغ</span>
                    <PriceTag toman={row.amountToman} className="text-xs font-bold" />
                  </div>
                </div>
              )}
            />
          </TabsContent>

          {/* ---------------- تب تراکنش‌ها ---------------- */}
          <TabsContent value="transactions" className="mt-4">
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-info/25 bg-info/10 p-3 text-[11px] leading-5 text-info">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>تراکنش‌ها فقط از طریق کال‌بک درگاه نتیجه‌گیری می‌شوند.</span>
            </div>
            <DataTable
              columns={txColumns}
              rows={txList}
              rowKey={(row) => row.id}
              loading={transactions.isLoading}
              error={transactions.isError ? "دریافت تراکنش‌ها انجام نشد." : null}
              onRetry={() => transactions.refetch()}
              emptyTitle="تراکنشی ثبت نشده است"
              emptyDescription="پس از اولین پرداخت از طریق درگاه، تراکنش‌های شما اینجا نمایش داده می‌شوند."
              emptyAction={
                <Button size="sm" onClick={() => router.navigate(routes.portalPlans)}>
                  <Landmark className="size-3.5" />
                  شروع خرید
                </Button>
              }
              mobileCard={(row) => (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="ltr-iso text-xs font-extrabold" dir="ltr">
                      {row.ref}
                    </span>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{gatewayLabel(row.gateway)}</span>
                    <span>{formatDateTime(row.createdAt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">مبلغ</span>
                    <PriceTag toman={row.amountToman} className="text-xs font-bold" />
                  </div>
                </div>
              )}
            />
          </TabsContent>
        </Tabs>
      </Reveal>

      {/* دیالوگ نمای چاپی فاکتور */}
      <Dialog
        open={!!selectedInvoice}
        onOpenChange={(open) => {
          if (!open) setSelectedInvoice(null);
        }}
      >
        <DialogContent
          dir="rtl"
          className="max-h-[85vh] overflow-y-auto scrollbar-slim sm:max-w-2xl"
        >
          {selectedInvoice ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="size-4 text-primary" />
                  فاکتور {selectedInvoice.number}
                </DialogTitle>
                <DialogDescription>
                  نمای قابل چاپ فاکتور؛ برای ذخیره PDF از گزینه چاپ مرورگر استفاده کنید.
                </DialogDescription>
              </DialogHeader>

              <InvoicePrintable invoice={selectedInvoice} />

              <DialogFooter className="flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-[10px] leading-5 text-muted-foreground">
                  <Receipt className="size-3 shrink-0" />
                  برای ذخیره PDF از گزینه چاپ مرورگر استفاده کنید.
                </p>
                <Button onClick={() => window.print()}>
                  <Printer className="size-4" />
                  چاپ / ذخیره PDF
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
