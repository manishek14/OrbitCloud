"use client";

// امنیت حساب — change password, active sessions (with per-session revoke)
// and static security recommendations. All data from real API responses.

import { useState } from "react";
import {
  Eye,
  EyeOff,
  KeyRound,
  LifeBuoy,
  Lightbulb,
  Loader2,
  LogIn,
  Monitor,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Link } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useChangePassword, useRevokeSession, useSessions } from "@/lib/api/hooks";
import { ApiRequestError, errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField, TextField } from "@/components/abrit/form-field";
import { ConfirmDialog } from "@/components/abrit/confirm-dialog";
import { PageHeader, EmptyState, ErrorState } from "@/components/abrit/ui";
import { Reveal } from "@/components/abrit/motion";
import { formatDateTime, formatRelative } from "@/lib/format/fa";
import type { SessionDTO } from "@/lib/api/types";

/** Short Persian browser/device label parsed from the session's user agent. */
function parseUserAgent(ua: string | null): string {
  if (!ua) return "مرورگر ناشناس";
  const browser = ua.includes("Firefox")
    ? "فایرفاکس"
    : ua.includes("Edg")
      ? "ادج"
      : ua.includes("Chrome")
        ? "کروم"
        : ua.includes("Safari")
          ? "سافاری"
          : "مرورگر ناشناس";
  const device = /Mobile|Android|iPhone|iPad/i.test(ua) ? "موبایل" : "دسکتاپ";
  return `${browser} — ${device}`;
}

// ---------------------------------------------------------------------------
// Card 1: change password
// ---------------------------------------------------------------------------

function ChangePasswordCard() {
  const changePassword = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});

  const validate = (): boolean => {
    const e: typeof errors = {};
    if (!current) e.current = "رمز عبور فعلی را وارد کنید.";
    if (next.length < 8 || !/[A-Za-zآ-ی]/.test(next) || !/[0-9]/.test(next)) {
      e.next = "رمز عبور جدید باید حداقل ۸ نویسه و شامل حرف و رقم باشد.";
    }
    if (confirm !== next) e.confirm = "تکرار رمز عبور با رمز جدید یکسان نیست.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    changePassword.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          toast.success("رمز عبور با موفقیت تغییر کرد");
          setCurrent("");
          setNext("");
          setConfirm("");
          setErrors({});
        },
        onError: (error) => {
          if (error instanceof ApiRequestError && error.code === "BAD_CREDENTIALS") {
            toast.error("رمز عبور فعلی صحیح نیست");
            setErrors((p) => ({ ...p, current: "رمز عبور فعلی صحیح نیست." }));
          } else if (error instanceof ApiRequestError && error.code === "WEAK_PASSWORD") {
            setErrors((p) => ({ ...p, next: error.message }));
          } else {
            toast.error(errorMessage(error));
          }
        },
      },
    );
  };

  return (
    <Reveal className="rounded-xl border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-extrabold">
        <KeyRound className="size-4 text-primary" />
        تغییر رمز عبور
      </h2>
      <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
        رمز عبور پنل کاربری شماست؛ رمز عبور ورود به Orbit Drive جداگانه از صفحه Drive مدیریت می‌شود.
      </p>
      <div className="mt-4 space-y-4">
        <FormField label="رمز عبور فعلی" htmlFor="current-password" required error={errors.current ?? null}>
          <div className="relative">
            <TextField
              id="current-password"
              type={show ? "text" : "password"}
              dir="ltr"
              autoComplete="current-password"
              className="pe-10"
              value={current}
              invalid={Boolean(errors.current)}
              disabled={changePassword.isPending}
              onChange={(e) => {
                setCurrent(e.target.value);
                if (errors.current) setErrors((p) => ({ ...p, current: undefined }));
              }}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent"
              aria-label={show ? "پنهان کردن رمزها" : "نمایش رمزها"}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </FormField>
        <FormField
          label="رمز عبور جدید"
          htmlFor="new-password"
          required
          error={errors.next ?? null}
          hint="حداقل ۸ نویسه شامل حرف و رقم"
        >
          <TextField
            id="new-password"
            type={show ? "text" : "password"}
            dir="ltr"
            autoComplete="new-password"
            className="pe-10"
            value={next}
            invalid={Boolean(errors.next)}
            disabled={changePassword.isPending}
            onChange={(e) => {
              setNext(e.target.value);
              if (errors.next) setErrors((p) => ({ ...p, next: undefined }));
            }}
          />
        </FormField>
        <FormField
          label="تکرار رمز عبور جدید"
          htmlFor="confirm-password"
          required
          error={errors.confirm ?? null}
        >
          <TextField
            id="confirm-password"
            type={show ? "text" : "password"}
            dir="ltr"
            autoComplete="new-password"
            value={confirm}
            invalid={Boolean(errors.confirm)}
            disabled={changePassword.isPending}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (errors.confirm) setErrors((p) => ({ ...p, confirm: undefined }));
            }}
          />
        </FormField>
        <Button className="w-full" onClick={handleSubmit} disabled={changePassword.isPending}>
          {changePassword.isPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          تغییر رمز عبور
        </Button>
      </div>
    </Reveal>
  );
}

// ---------------------------------------------------------------------------
// Card 2: active sessions
// ---------------------------------------------------------------------------

function SessionsCard() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const [revokeTarget, setRevokeTarget] = useState<SessionDTO | null>(null);

  const list = sessions.data ?? [];

  const handleRevoke = () => {
    if (!revokeTarget) return;
    revoke.mutate(revokeTarget.id, {
      onSuccess: () => {
        toast.success("نشست انتخاب‌شده بسته شد");
        setRevokeTarget(null);
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  return (
    <Reveal delay={0.06} className="rounded-xl border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-extrabold">
        <LogIn className="size-4 text-primary" />
        نشست‌های فعال
      </h2>
      <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
        دستگاه‌ها و مرورگرهایی که هم‌اکنون با حساب شما وارد شده‌اند. نشست‌های ناشناس را ببندید.
      </p>

      {sessions.isError ? (
        <ErrorState
          className="mt-4"
          message="دریافت نشست‌ها انجام نشد."
          onRetry={() => sessions.refetch()}
        />
      ) : sessions.isLoading ? (
        <div className="mt-4 space-y-2.5">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState className="mt-4" title="نشست فعالی یافت نشد." />
      ) : (
        <ul className="mt-4 space-y-2.5">
          {list.map((session) => (
            <li
              key={session.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 ${
                session.current ? "border-primary/30 bg-primary/5" : "border-border bg-background/40"
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
                    session.current ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                  aria-hidden="true"
                >
                  {parseUserAgent(session.userAgent).includes("موبایل") ? (
                    <Smartphone className="size-5" />
                  ) : (
                    <Monitor className="size-5" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-xs font-bold">
                    {parseUserAgent(session.userAgent)}
                    {session.current ? (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-extrabold text-primary">
                        نشست فعلی
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
                    ایجاد: {formatRelative(session.createdAt)} — آخرین فعالیت: {formatRelative(session.lastSeenAt)}
                    <br />
                    اعتبار تا: {formatDateTime(session.expiresAt)}
                  </p>
                </div>
              </div>
              {session.current ? (
                <span className="text-[10px] font-bold text-muted-foreground">این نشست شماست</span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={revoke.isPending && revokeTarget?.id === session.id}
                  onClick={() => setRevokeTarget(session)}
                >
                  بستن نشست
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !revoke.isPending && !open && setRevokeTarget(null)}
        title="بستن نشست انتخاب‌شده؟"
        description={`نشست «${revokeTarget ? parseUserAgent(revokeTarget.userAgent) : ""}» بسته می‌شود و برای ورود دوباره، احراز هویت لازم است.`}
        confirmLabel="بستن نشست"
        destructive
        pending={revoke.isPending}
        onConfirm={handleRevoke}
      />
    </Reveal>
  );
}

// ---------------------------------------------------------------------------
// Card 3: security recommendations
// ---------------------------------------------------------------------------

const SECURITY_TIPS: { icon: typeof ShieldCheck; title: string; body: string }[] = [
  {
    icon: KeyRound,
    title: "رمز قوی و یکتا",
    body: "برای پنل Orbit رمزی یکتا انتخاب کنید که هیچ‌کدام از سرویس‌های دیگرتان از آن استفاده نمی‌کند.",
  },
  {
    icon: LogIn,
    title: "خروج از نشست‌های ناشناس",
    body: "نشست‌هایی که دستگاه آنها را نمی‌شناسید را از فهرست «نشست‌های فعال» ببندید و رمز عبور را تغییر دهید.",
  },
  {
    icon: LifeBuoy,
    title: "نگه‌داری امن رمز Drive",
    body: "رمز عبور ورود به Orbit Drive جدای از رمز پنل است؛ آن را جداگانه و در جای امن نگه دارید.",
  },
];

function TipsCard() {
  return (
    <Reveal delay={0.12} className="rounded-xl border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-extrabold">
        <Lightbulb className="size-4 text-primary" />
        توصیه‌های امنیتی
      </h2>
      <ul className="mt-4 space-y-3.5">
        {SECURITY_TIPS.map((tip) => (
          <li key={tip.title} className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success" aria-hidden="true">
              <tip.icon className="size-4.5" />
            </span>
            <div>
              <p className="text-xs font-extrabold">{tip.title}</p>
              <p className="mt-1 text-[11px] leading-6 text-muted-foreground">{tip.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-[10px] leading-5 text-muted-foreground">
        مشکلی در امنیت حساب خود مشاهده می‌کنید؟ {" "}
        <Link to={routes.portalTickets} className="font-bold text-primary hover:text-primary/80">
          فوراً با پشتیبانی تماس بگیرید
        </Link>
        .
      </p>
    </Reveal>
  );
}

export default function SecurityView() {
  return (
    <>
      <PageHeader
        title="امنیت حساب"
        description="تغییر رمز عبور، مدیریت نشست‌های فعال و توصیه‌های امنیتی"
        breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "امنیت" }]}
      />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <ChangePasswordCard />
        <div className="space-y-5">
          <SessionsCard />
          <TipsCard />
        </div>
      </div>
    </>
  );
}
