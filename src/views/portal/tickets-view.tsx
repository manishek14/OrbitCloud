"use client";

// تیکت‌های پشتیبانی — فهرست با فیلتر وضعیت و جست‌وجو، و ثبت تیکت جدید
// (موضوع، دسته‌بندی، اولویت، شرح مشکل).

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { LifeBuoy, Loader2, MessageSquare, Plus } from "lucide-react";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useCreateTicket, useTickets } from "@/lib/api/hooks";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  SkeletonRows,
  StatusBadge,
} from "@/components/abrit/ui";
import { DataTable, type Column } from "@/components/abrit/data-table";
import { FormField, TextAreaField, TextField } from "@/components/abrit/form-field";
import { Reveal } from "@/components/abrit/motion";
import { formatRelative, toFaDigits } from "@/lib/format/fa";
import type { TicketListEntryDTO } from "@/lib/api/types";

type StatusFilter = "all" | "open" | "answered" | "closed";

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "همه" },
  { key: "open", label: "باز" },
  { key: "answered", label: "پاسخ داده شده" },
  { key: "closed", label: "بسته" },
];

const CATEGORY_OPTIONS = [
  { value: "technical", label: "فنی" },
  { value: "billing", label: "مالی" },
  { value: "sales", label: "فروش" },
  { value: "drive", label: "Drive" },
  { value: "other", label: "سایر" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "کم" },
  { value: "normal", label: "عادی" },
  { value: "high", label: "بالا" },
  { value: "urgent", label: "فوری" },
];

export default function TicketsView() {
  const router = useRouter();
  const tickets = useTickets();
  const createTicket = useCreateTicket();

  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("technical");
  const [priority, setPriority] = useState("normal");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<{ subject?: string; body?: string }>({});

  const all = tickets.data ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((t) => {
      if (statusFilter === "open" && t.status !== "open" && t.status !== "pending_customer") return false;
      if (statusFilter === "answered" && t.status !== "answered") return false;
      if (statusFilter === "closed" && t.status !== "closed") return false;
      if (q && !t.subject.toLowerCase().includes(q) && !t.number.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, statusFilter, query]);

  function countFor(filter: StatusFilter): number {
    if (filter === "all") return all.length;
    return all.filter((t) => {
      if (filter === "open") return t.status === "open" || t.status === "pending_customer";
      if (filter === "answered") return t.status === "answered";
      return t.status === "closed";
    }).length;
  }

  function openCreateDialog() {
    setErrors({});
    setCreateOpen(true);
  }

  function submitTicket() {
    const errs: typeof errors = {};
    if (subject.trim().length < 3) errs.subject = "موضوع باید حداقل ۳ نویسه باشد.";
    if (body.trim().length < 10) errs.body = "شرح مشکل باید حداقل ۱۰ نویسه باشد.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    createTicket.mutate(
      { subject: subject.trim(), category, priority, body: body.trim() },
      {
        onSuccess: () => {
          toast.success("تیکت ثبت شد");
          setCreateOpen(false);
          setSubject("");
          setBody("");
          setCategory("technical");
          setPriority("normal");
          setErrors({});
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  const columns: Column<TicketListEntryDTO>[] = [
    {
      key: "number",
      header: "شماره",
      cell: (row) => (
        <span className="ltr-iso text-xs font-bold" dir="ltr">
          {row.number}
        </span>
      ),
    },
    {
      key: "subject",
      header: "موضوع",
      cell: (row) => <span className="block max-w-48 truncate text-xs font-semibold sm:max-w-64">{row.subject}</span>,
    },
    { key: "category", header: "دسته", cell: (row) => <StatusBadge status={row.category} /> },
    { key: "priority", header: "اولویت", cell: (row) => <StatusBadge status={row.priority} /> },
    { key: "status", header: "وضعیت", cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: "updatedAt",
      header: "آخرین فعالیت",
      cell: (row) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">{formatRelative(row.updatedAt)}</span>
      ),
    },
    {
      key: "messageCount",
      header: "پیام‌ها",
      cell: (row) => (
        <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
          <MessageSquare className="size-3.5" />
          {toFaDigits(row.messageCount)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="تیکت‌های پشتیبانی"
        description="پیگیری درخواست‌های فنی، مالی و فروش با کارشناسان Orbit."
        breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "تیکت‌های پشتیبانی" }]}
        actions={
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="size-3.5" />
            ثبت تیکت جدید
          </Button>
        }
      />

      {tickets.isError ? (
        <ErrorState message="دریافت فهرست تیکت‌ها انجام نشد." onRetry={() => tickets.refetch()} />
      ) : (
        <div className="space-y-4">
          {/* فیلترها و جست‌وجو */}
          <Reveal className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="فیلتر وضعیت تیکت">
              {STATUS_FILTERS.map((f) => {
                const active = statusFilter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setStatusFilter(f.key)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {f.label}
                    <span className="tabular-nums opacity-70">{toFaDigits(countFor(f.key))}</span>
                  </button>
                );
              })}
            </div>
            <div className="w-full sm:w-64">
              <SearchInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClear={() => setQuery("")}
                placeholder="جست‌وجو در موضوع یا شماره…"
                aria-label="جست‌وجو در تیکت‌ها"
              />
            </div>
          </Reveal>

          <Reveal delay={0.06}>
            <DataTable
              columns={columns}
              rows={filtered}
              rowKey={(row) => row.id}
              loading={tickets.isLoading}
              emptyTitle={all.length === 0 ? "تیکتی ثبت نکرده‌اید" : "تیکتی مطابق فیلتر یافت نشد"}
              emptyDescription={
                all.length === 0
                  ? "برای هر موضوع فنی، مالی یا فروش می‌توانید تیکت ثبت کنید و پاسخ کارشناسان را همین‌جا دنبال کنید."
                  : "فیلتر یا عبارت جست‌وجو را تغییر دهید."
              }
              emptyAction={
                all.length === 0 ? (
                  <Button size="sm" onClick={openCreateDialog}>
                    <Plus className="size-3.5" />
                    ثبت اولین تیکت
                  </Button>
                ) : undefined
              }
              onRowClick={(row) => router.navigate(routes.portalTicket(row.id))}
              mobileCard={(row) => (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="ltr-iso text-[11px] font-bold text-muted-foreground" dir="ltr">
                      {row.number}
                    </span>
                    <StatusBadge status={row.status} />
                  </div>
                  <p className="line-clamp-1 text-xs font-bold">{row.subject}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={row.category} />
                    <StatusBadge status={row.priority} />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{formatRelative(row.updatedAt)}</span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <MessageSquare className="size-3" />
                      {toFaDigits(row.messageCount)}
                    </span>
                  </div>
                </div>
              )}
            />
          </Reveal>
        </div>
      )}

      {/* دیالوگ ثبت تیکت جدید */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent dir="rtl" className="max-h-[85vh] overflow-y-auto scrollbar-slim sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LifeBuoy className="size-4 text-primary" />
              ثبت تیکت جدید
            </DialogTitle>
            <DialogDescription>
              درخواست خود را شرح دهید؛ کارشناسان در ساعات کاری پاسخ می‌دهند.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitTicket();
            }}
          >
            <FormField label="موضوع" htmlFor="ticket-subject" required error={errors.subject} hint="حداقل ۳ نویسه">
              <TextField
                id="ticket-subject"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  if (errors.subject) setErrors((p) => ({ ...p, subject: undefined }));
                }}
                invalid={!!errors.subject}
                placeholder="مثال: خطای اتصال VPN دفتر مرکزی"
              />
            </FormField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="دسته‌بندی" htmlFor="ticket-category" required>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="ticket-category" className="w-full">
                    <SelectValue placeholder="انتخاب دسته" />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    {CATEGORY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="اولویت" htmlFor="ticket-priority" required>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger id="ticket-priority" className="w-full">
                    <SelectValue placeholder="انتخاب اولویت" />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    {PRIORITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <FormField
              label="شرح مشکل"
              htmlFor="ticket-body"
              required
              error={errors.body}
              hint="حداقل ۱۰ نویسه — جزئیات بیشتر، پاسخ دقیق‌تری دریافت می‌کند."
            >
              <TextAreaField
                id="ticket-body"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  if (errors.body) setErrors((p) => ({ ...p, body: undefined }));
                }}
                invalid={!!errors.body}
                placeholder="شرح کامل مشکل، زمان وقوع و پیام‌های خطای دیده‌شده…"
                className="min-h-32"
              />
            </FormField>

            <DialogFooter className="border-t pt-4">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createTicket.isPending}>
                انصراف
              </Button>
              <Button type="submit" disabled={createTicket.isPending}>
                {createTicket.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                ثبت تیکت
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
