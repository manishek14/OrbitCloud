"use client";

// اعلان‌ها — in-panel notification center: category icons, unread highlight,
// per-item and bulk mark-as-read, and client-side filter chips.

import { useMemo, useState } from "react";
import {
  Bell,
  CheckCheck,
  Cloud,
  CreditCard,
  LifeBuoy,
  Receipt,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useMarkNotificationsRead, useNotifications } from "@/lib/api/hooks";
import { errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  PageHeader,
  EmptyState,
  ErrorState,
} from "@/components/abrit/ui";
import { Stagger, StaggerItem } from "@/components/abrit/motion";
import { SkeletonRows } from "@/components/abrit/ui";
import { cn } from "@/lib/utils";
import { formatRelative, toFaDigits } from "@/lib/format/fa";
import type { NotificationDTO } from "@/lib/api/types";

const CATEGORY_ICONS: Record<NotificationDTO["category"], typeof Receipt> = {
  order: Receipt,
  payment: CreditCard,
  drive: Cloud,
  ticket: LifeBuoy,
  system: Settings,
  security: ShieldCheck,
};

type FilterKey = "all" | "unread" | "read";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "همه" },
  { key: "unread", label: "خوانده‌نشده" },
  { key: "read", label: "خوانده‌شده" },
];

export default function NotificationsView() {
  const router = useRouter();
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const [filter, setFilter] = useState<FilterKey>("all");

  const list = notifications.data ?? [];
  const unreadCount = list.filter((n) => !n.readAt).length;
  const filtered = useMemo(() => {
    if (filter === "unread") return list.filter((n) => !n.readAt);
    if (filter === "read") return list.filter((n) => Boolean(n.readAt));
    return list;
  }, [list, filter]);

  const handleMarkAll = () => {
    markRead.mutate(
      { all: true },
      {
        onSuccess: () => toast.success("همه اعلان‌ها خوانده‌شده علامت‌گذاری شدند"),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  const handleOpen = (notification: NotificationDTO) => {
    if (!notification.readAt) {
      markRead.mutate({ ids: [notification.id] }, { onError: (error) => toast.error(errorMessage(error)) });
    }
    if (notification.link) router.navigate(notification.link);
  };

  return (
    <>
      <PageHeader
        title="اعلان‌ها"
        description="رویدادهای سفارش، پرداخت، Drive و پشتیبانی شما"
        breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "اعلان‌ها" }]}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAll}
            disabled={unreadCount === 0 || markRead.isPending}
          >
            <CheckCheck className="size-3.5" />
            علامت‌گذاری همه به‌عنوان خوانده‌شده
          </Button>
        }
      />

      {notifications.isError ? (
        <ErrorState
          message="دریافت اعلان‌ها انجام نشد."
          onRetry={() => notifications.refetch()}
        />
      ) : notifications.isLoading ? (
        <SkeletonRows rows={6} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Bell className="size-6" />}
          title="اعلان جدیدی ندارید"
          description="اعلان‌های سفارش، پرداخت، Drive و تیکت‌های شما اینجا نمایش داده می‌شوند."
          action={
            <Button size="sm" variant="outline" onClick={() => router.navigate(routes.portal)}>
              بازگشت به داشبورد
            </Button>
          }
        />
      ) : (
        <>
          {/* Filter chips */}
          <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="فیلتر اعلان‌ها">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cn(
                  "flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-xs font-bold transition-colors",
                  filter === f.key
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {f.label}
                {f.key === "unread" && unreadCount > 0 ? (
                  <span className="flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-extrabold text-primary-foreground">
                    {toFaDigits(unreadCount)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Bell className="size-6" />}
              title={filter === "unread" ? "اعلان خوانده‌نشده ندارید" : "اعلان خوانده‌شده‌ای وجود ندارد"}
              action={
                <Button size="sm" variant="outline" onClick={() => setFilter("all")}>
                  نمایش همه اعلان‌ها
                </Button>
              }
            />
          ) : (
            <Stagger className="space-y-2.5">
              {filtered.map((notification) => {
                const Icon = CATEGORY_ICONS[notification.category] ?? Bell;
                const unread = !notification.readAt;
                return (
                  <StaggerItem key={notification.id}>
                    <button
                      type="button"
                      onClick={() => handleOpen(notification)}
                      className={cn(
                        "flex w-full items-start gap-3.5 rounded-xl border p-4 text-start transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                        unread ? "border-primary/25 bg-primary/5" : "border-border bg-card",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-xl",
                          unread ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                        )}
                        aria-hidden="true"
                      >
                        <Icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className={cn("flex items-center gap-2 text-xs", unread ? "font-extrabold text-primary" : "font-bold")}>
                            {unread ? (
                              <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="خوانده‌نشده" />
                            ) : null}
                            {notification.title}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatRelative(notification.createdAt)}
                          </span>
                        </span>
                        <span className="mt-1.5 block text-[11px] leading-6 text-muted-foreground">
                          {notification.body}
                        </span>
                      </span>
                    </button>
                  </StaggerItem>
                );
              })}
            </Stagger>
          )}
        </>
      )}
    </>
  );
}
