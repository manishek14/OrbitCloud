"use client";

// گفت‌وگوی تیکت — نمایش مکالمه مشتری/کارشناس (poll زنده هر ۱۵ ثانیه)،
// پاسخ‌گویی و بستن تیکت توسط مشتری.

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Ban, Headset, LifeBuoy, Loader2, Send, User } from "lucide-react";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useCloseTicket, useReplyTicket, useTicket } from "@/lib/api/hooks";
import { errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import {
  ErrorState,
  PageHeader,
  SkeletonRows,
  StatusBadge,
} from "@/components/abrit/ui";
import { FormField, TextAreaField } from "@/components/abrit/form-field";
import { ConfirmDialog } from "@/components/abrit/confirm-dialog";
import { Reveal } from "@/components/abrit/motion";
import { cn } from "@/lib/utils";
import { formatDateTime, formatRelative } from "@/lib/format/fa";
import type { TicketMessageDTO } from "@/lib/api/types";

function MessageBubble({ message }: { message: TicketMessageDTO }) {
  if (message.senderRole === "system") {
    return (
      <div className="text-center" role="note">
        <p className="inline-block max-w-full rounded-full bg-muted px-3.5 py-1.5 text-[10px] leading-5 text-muted-foreground">
          {message.body}
        </p>
        <p className="mt-1 text-[9px] text-muted-foreground/70">{formatRelative(message.createdAt)}</p>
      </div>
    );
  }

  const isCustomer = message.senderRole === "customer";
  return (
    <div className={cn("flex", isCustomer ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[75%]",
          isCustomer ? "bg-primary/10" : "border bg-card",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full",
              isCustomer ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
            )}
            aria-hidden="true"
          >
            {isCustomer ? <User className="size-3.5" /> : <Headset className="size-3.5" />}
          </span>
          <span className="text-[11px] font-bold">{message.senderName}</span>
          <span className="text-[10px] text-muted-foreground">{formatRelative(message.createdAt)}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6">{message.body}</p>
      </div>
    </div>
  );
}

export default function TicketDetailView({ id }: { id: string }) {
  const router = useRouter();
  const ticket = useTicket(id);
  const replyTicket = useReplyTicket();
  const closeTicket = useCloseTicket();
  const queryClient = useQueryClient();

  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [closeConfirm, setCloseConfirm] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageCount = useRef(-1);

  const data = ticket.data;
  const messages = data?.messages ?? [];
  const isClosed = data?.status === "closed";

  // اسکرول خودکار به آخرین پیام (در بارگذاری اولیه و با هر پیام جدید).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (messages.length !== lastMessageCount.current) {
      lastMessageCount.current = messages.length;
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages.length, data]);

  function sendReply() {
    const t = reply.trim();
    if (t.length < 2) {
      setReplyError("متن پاسخ باید حداقل ۲ نویسه باشد.");
      return;
    }
    setReplyError(null);
    replyTicket.mutate(
      { id, body: t },
      {
        onSuccess: () => {
          setReply("");
          toast.success("پاسخ شما ثبت شد");
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  function close() {
    closeTicket.mutate(id, {
      onSuccess: () => {
        toast.success("تیکت بسته شد");
        setCloseConfirm(false);
        void queryClient.invalidateQueries({ queryKey: ["ticket", id] });
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  }

  if (ticket.isError) {
    return (
      <>
        <PageHeader
          title="جزئیات تیکت"
          breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "تیکت‌ها" }, { label: "جزئیات تیکت" }]}
        />
        <ErrorState
          message="تیکت مورد نظر یافت نشد یا خطایی در دریافت آن رخ داد."
          onRetry={() => ticket.refetch()}
        />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => router.navigate(routes.portalTickets)}>
            <ArrowRight className="size-4" />
            بازگشت به تیکت‌ها
          </Button>
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader
          title="جزئیات تیکت"
          breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "تیکت‌ها" }, { label: "جزئیات تیکت" }]}
        />
        <SkeletonRows rows={7} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={data.subject}
        description={`شماره تیکت ${data.number} — ثبت‌شده در ${formatDateTime(data.createdAt)}`}
        breadcrumbs={[
          { label: "پنل کاربری", to: routes.portal },
          { label: "تیکت‌ها", to: routes.portalTickets },
          { label: data.number },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.navigate(routes.portalTickets)}>
              <ArrowRight className="size-3.5" />
              بازگشت
            </Button>
            {!isClosed ? (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setCloseConfirm(true)}
                disabled={closeTicket.isPending}
              >
                {closeTicket.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
                بستن تیکت
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={data.status} />
        <StatusBadge status={data.priority} />
        <StatusBadge status={data.category} />
        {ticket.isFetching ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            همگام‌سازی…
          </span>
        ) : null}
      </div>

      <Reveal>
        {/* ناحیه مکالمه */}
        <div
          ref={scrollRef}
          className="max-h-[60vh] space-y-3 overflow-y-auto scrollbar-slim rounded-xl border bg-muted/30 p-4"
          role="log"
          aria-label="گفت‌وگوی تیکت"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">
              پیامی در این تیکت ثبت نشده است.
            </p>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
        </div>
      </Reveal>

      {/* جعبه پاسخ */}
      <Reveal delay={0.06} className="mt-4">
        {isClosed ? (
          <div className="rounded-xl border border-dashed bg-muted/40 p-5 text-center">
            <LifeBuoy className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2.5 text-xs font-bold leading-6 text-muted-foreground">
              این تیکت بسته شده است؛ برای پیگیری جدید تیکت جدید ثبت کنید.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => router.navigate(routes.portalTickets)}
            >
              ثبت تیکت جدید
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border bg-card p-4">
            <FormField
              label="پاسخ شما"
              htmlFor="ticket-reply"
              error={replyError}
              hint="حداقل ۲ نویسه — پاسخ شما برای کارشناسان ارسال می‌شود."
            >
              <TextAreaField
                id="ticket-reply"
                value={reply}
                onChange={(e) => {
                  setReply(e.target.value);
                  if (replyError) setReplyError(null);
                }}
                disabled={replyTicket.isPending}
                invalid={!!replyError}
                placeholder="پیام خود را بنویسید…"
                className="min-h-24"
              />
            </FormField>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[10px] leading-5 text-muted-foreground">
                این گفت‌وگو هر ۱۵ ثانیه به‌صورت خودکار به‌روزرسانی می‌شود.
              </p>
              <Button onClick={sendReply} disabled={replyTicket.isPending} className="shrink-0">
                {replyTicket.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                ارسال پاسخ
              </Button>
            </div>
          </div>
        )}
      </Reveal>

      <ConfirmDialog
        open={closeConfirm}
        onOpenChange={(open) => {
          if (!open) setCloseConfirm(false);
        }}
        title="بستن تیکت"
        description="با بستن تیکت، امکان ادامه گفت‌وگو در آن از بین می‌رود و برای پیگیری باید تیکت جدید ثبت کنید."
        confirmLabel="بستن تیکت"
        destructive
        pending={closeTicket.isPending}
        onConfirm={close}
      />
    </>
  );
}
