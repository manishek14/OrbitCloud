"use client";

// AbrIT Drive — the customer's cloud-storage control panel.
// HONEST STATES ONLY: the view renders exactly what /api/drive/status returns
// (ready / not_provisioned / unreachable / auth_failed / not_configured /
// missing_on_server) with the server's detail messages; nothing is faked.

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Cloud,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  HardDrive,
  History,
  Info,
  LifeBuoy,
  Loader2,
  Lock,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Link as RouterLink } from "@/lib/router";
import { routes } from "@/lib/routes";
import {
  useActivateDrive,
  useChangeDriveQuota,
  useCommerceCatalog,
  useDriveOverview,
  useMe,
  useSetDriveEnabled,
  useSyncDrive,
} from "@/lib/api/hooks";
import { ApiRequestError, errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FormField, TextField } from "@/components/abrit/form-field";
import { ConfirmDialog } from "@/components/abrit/confirm-dialog";
import { PageHeader, StatusBadge } from "@/components/abrit/ui";
import { Reveal } from "@/components/abrit/motion";
import { cn } from "@/lib/utils";
import { formatBytes, formatDateTime, formatPercent, formatRelative, formatToman, toFaDigits } from "@/lib/format/fa";
import type { DriveEventDTO, DriveOverviewDTO } from "@/lib/api/types";

/** Trial plan quota is a fixed, documented 100 MB (display only). */
const TRIAL_QUOTA_BYTES = 100 * 1024 * 1024;

const EVENT_LABELS: Record<string, string> = {
  provisioned: "ایجاد حساب",
  resumed: "بازیافت حساب",
  quota_changed: "تغییر سهمیه",
  enabled: "فعال‌سازی",
  disabled: "غیرفعال‌سازی",
  sync: "همگام‌سازی",
  error: "خطا",
};

/** Drive plan option built from the commerce catalog (trial is local display-only). */
interface PlanOption {
  code: string;
  nameFa: string;
  quotaBytes: number;
  monthlyPriceToman: number | null;
}

function usePlanOptions(): { options: PlanOption[]; planName: (code: string) => string } {
  const catalog = useCommerceCatalog();
  const options = useMemo<PlanOption[]>(() => {
    const commercial =
      catalog.data?.packages.map((p) => ({
        code: p.code,
        nameFa: p.nameFa,
        quotaBytes: p.driveQuotaBytes,
        monthlyPriceToman: p.monthlyPriceToman,
      })) ?? [];
    return [
      { code: "trial", nameFa: "آزمایشی", quotaBytes: TRIAL_QUOTA_BYTES, monthlyPriceToman: null },
      ...commercial,
    ];
  }, [catalog.data]);
  const planName = (code: string) => options.find((o) => o.code === code)?.nameFa ?? code;
  return { options, planName };
}

// ---------------------------------------------------------------------------
// Ready state: account card + usage + actions + events timeline
// ---------------------------------------------------------------------------

function DriveEventsTimeline({ events }: { events: DriveEventDTO[] }) {
  if (events.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">هنوز رویدادی ثبت نشده است.</p>;
  }
  return (
    <ol className="max-h-72 space-y-0 overflow-y-auto scrollbar-slim pe-1">
      {events.map((event, index) => (
        <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
          {index < events.length - 1 ? (
            <span className="absolute start-[7px] top-4 h-full w-px bg-border" aria-hidden="true" />
          ) : null}
          <span
            className={cn(
              "relative z-10 mt-1 size-[15px] shrink-0 rounded-full border-2",
              event.type === "error"
                ? "border-destructive bg-destructive/20"
                : event.type === "disabled"
                  ? "border-warning bg-warning/20"
                  : "border-primary bg-primary/20",
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <p className="text-xs font-bold">{EVENT_LABELS[event.type] ?? event.type}</p>
              <span className="shrink-0 text-[10px] text-muted-foreground">{formatRelative(event.createdAt)}</span>
            </div>
            {event.detail ? (
              <p className="mt-0.5 break-words text-[11px] leading-5 text-muted-foreground">{event.detail}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function DriveReadyState({ drive }: { drive: DriveOverviewDTO }) {
  const account = drive.account!;
  const usage = drive.usage;
  const syncDrive = useSyncDrive();
  const setEnabled = useSetDriveEnabled();
  const { options } = usePlanOptions();

  const [quotaOpen, setQuotaOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string>(account.planCode);
  const [disableOpen, setDisableOpen] = useState(false);
  const changeQuota = useChangeDriveQuota();

  const copyUsername = async () => {
    try {
      await navigator.clipboard.writeText(account.ncUsername);
      toast.success("نام کاربری Drive کپی شد");
    } catch {
      toast.error("کپی نام کاربری انجام نشد.");
    }
  };

  const handleSync = () => {
    syncDrive.mutate(undefined, {
      onSuccess: () => toast.success("همگام‌سازی Drive انجام شد"),
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  const handleQuotaChange = () => {
    changeQuota.mutate(
      { planCode: selectedPlan },
      {
        onSuccess: () => {
          toast.success("سهمیه Drive تغییر کرد");
          setQuotaOpen(false);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  const handleDisable = () => {
    setEnabled.mutate(
      { enabled: false },
      {
        onSuccess: () => {
          toast.success("حساب Drive غیرفعال شد");
          setDisableOpen(false);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  const handleEnable = () => {
    setEnabled.mutate(
      { enabled: true },
      {
        onSuccess: () => toast.success("حساب Drive فعال شد"),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* Account card */}
        <Reveal className="rounded-xl border bg-card p-5 lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-info/10 text-info" aria-hidden="true">
                <Cloud className="size-6" />
              </span>
              <div className="min-w-0">
                <h2 className="flex flex-wrap items-center gap-2 text-sm font-extrabold">
                  حساب Drive
                  <StatusBadge status={account.status} />
                </h2>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {account.planNameFa} — سهمیه {account.quotaLabel}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-[10px] font-bold text-muted-foreground">نام کاربری</p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="ltr-iso truncate text-xs font-extrabold" dir="ltr">
                  {account.ncUsername}
                </span>
                <button
                  type="button"
                  onClick={copyUsername}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-accent"
                  aria-label="کپی نام کاربری Drive"
                >
                  <Copy className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-[10px] font-bold text-muted-foreground">نام نمایشی</p>
              <p className="mt-1.5 truncate text-xs font-bold">{account.ncDisplayName ?? "—"}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-[10px] font-bold text-muted-foreground">تاریخ ایجاد حساب</p>
              <p className="mt-1.5 text-xs font-bold">{formatDateTime(account.provisionedAt)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-[10px] font-bold text-muted-foreground">آخرین همگام‌سازی</p>
              <p className="mt-1.5 text-xs font-bold">{formatRelative(account.lastSyncedAt)}</p>
            </div>
          </div>

          {/* Usage */}
          <div className="mt-5 rounded-xl border border-info/25 bg-info/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-extrabold">
                <HardDrive className="size-4 text-info" />
                مصرف فضای ابری
              </p>
              {usage ? (
                <p className="text-xs font-extrabold text-info">{formatPercent(usage.relative)}٪ استفاده شده</p>
              ) : null}
            </div>
            {usage ? (
              <>
                <Progress
                  value={Math.min(100, usage.relative * 100)}
                  className="mt-3 h-2.5"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {formatBytes(usage.usedBytes)} از {formatBytes(usage.totalBytes)} استفاده شده
                  </span>
                  <span>{formatBytes(usage.freeBytes)} فضای آزاد</span>
                </div>
              </>
            ) : (
              <p className="mt-3 text-[11px] text-muted-foreground">
                اطلاعات مصرف هم‌اکنون قابل دریافت نیست؛ با «همگام‌سازی» دوباره تلاش کنید.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <a href={drive.loginUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" />
                  ورود به AbrIT Drive
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={syncDrive.isPending}
              >
                {syncDrive.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="size-3.5" />
                )}
                همگام‌سازی
              </Button>
              <Button variant="outline" size="sm" onClick={() => setQuotaOpen(true)}>
                <Settings2 className="size-3.5" />
                تغییر سهمیه / پلن
              </Button>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 sm:justify-start">
              <span className="text-[11px] font-bold">حساب فعال باشد</span>
              <Switch
                checked={account.status === "active"}
                disabled={setEnabled.isPending}
                onCheckedChange={(checked) => (checked ? handleEnable() : setDisableOpen(true))}
                aria-label="فعال یا غیرفعال کردن حساب Drive"
              />
            </label>
          </div>
        </Reveal>

        {/* Events timeline */}
        <Reveal delay={0.08} className="rounded-xl border bg-card p-5 lg:col-span-2">
          <h3 className="flex items-center gap-2 text-sm font-extrabold">
            <History className="size-4 text-primary" />
            رویدادهای Drive
          </h3>
          <p className="mt-1 text-[10px] text-muted-foreground">
            آخرین به‌روزرسانی: {formatRelative(drive.fetchedAt)}
          </p>
          <div className="mt-4">
            <DriveEventsTimeline events={drive.events} />
          </div>
        </Reveal>
      </div>

      {/* Quota / plan change dialog */}
      <Dialog open={quotaOpen} onOpenChange={(open) => !changeQuota.isPending && setQuotaOpen(open)}>
        <DialogContent dir="rtl" className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="size-4 text-primary" />
              تغییر سهمیه / پلن Drive
            </DialogTitle>
            <DialogDescription>
              سهمیه انتخابی بلافاصله روی سرور Drive اعمال می‌شود.
            </DialogDescription>
          </DialogHeader>

          <RadioGroup
            value={selectedPlan}
            onValueChange={setSelectedPlan}
            className="gap-2.5"
            aria-label="انتخاب پلن Drive"
          >
            {options.map((plan) => (
              <label
                key={plan.code}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3.5 transition-all",
                  selectedPlan === plan.code
                    ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                    : "border-border hover:border-primary/40 hover:bg-accent",
                )}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <RadioGroupItem value={plan.code} className="shrink-0" />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 text-xs font-extrabold">
                      {plan.nameFa}
                      {plan.code === account.planCode ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold text-muted-foreground">
                          پلن فعلی شما
                        </span>
                      ) : null}
                      {plan.code === "trial" ? (
                        <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[9px] font-bold text-warning">
                          آزمایشی — ۱۰۰ مگابایت
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {formatBytes(plan.quotaBytes)} فضای ابری
                      {plan.monthlyPriceToman !== null
                        ? ` — ${formatToman(plan.monthlyPriceToman)} تومان/ماه`
                        : " — بدون هزینه"}
                    </span>
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>

          <p className="flex items-start gap-1.5 rounded-lg bg-muted/60 px-3 py-2 text-[10px] leading-5 text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" />
            در production سهمیه مطابق پکیج‌های خریداری‌شده اعمال می‌شود؛ این ابزار تغییر فوری سهمیه روی سرور Drive است.
          </p>

          <DialogFooter className="flex-row gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={changeQuota.isPending}
              onClick={() => setQuotaOpen(false)}
            >
              انصراف
            </Button>
            <Button
              size="sm"
              disabled={changeQuota.isPending || selectedPlan === account.planCode}
              onClick={handleQuotaChange}
            >
              {changeQuota.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              اعمال سهمیه جدید
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable confirm */}
      <ConfirmDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        title="غیرفعال‌سازی حساب Drive"
        description="پس از غیرفعال‌سازی، ورود به Drive با این حساب ممکن نیست. فایل‌های شما حذف نمی‌شود و هر زمان می‌توانید حساب را دوباره فعال کنید."
        confirmLabel="غیرفعال‌سازی"
        destructive
        pending={setEnabled.isPending}
        onConfirm={handleDisable}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// not_provisioned state: activation form
// ---------------------------------------------------------------------------

function DriveActivationForm({ entitledPlanCode, pendingUsername, detail }: { entitledPlanCode: string | null; pendingUsername?: string; detail?: string | null }) {
  const { options, planName } = usePlanOptions();
  const activate = useActivateDrive();

  const [username, setUsername] = useState(pendingUsername ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [planCode, setPlanCode] = useState<string>("__pending__");
  const [errors, setErrors] = useState<{ username?: string; password?: string; confirm?: string }>({});

  // Default plan: the entitled package when the customer owns one, else trial.
  const effectivePlan = planCode === "__pending__" ? (entitledPlanCode ?? "trial") : planCode;

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!/^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/.test(username.trim().toLowerCase())) {
      next.username = "نام کاربری باید ۳ تا ۳۲ نویسه؛ فقط حروف کوچک انگلیسی، رقم و علامت‌های نقطه و خط تیره باشد.";
    }
    if (password.length < 8 || !/[A-Za-zآ-ی]/.test(password) || !/[0-9]/.test(password)) {
      next.password = "رمز عبور باید حداقل ۸ نویسه و شامل حرف و رقم باشد.";
    }
    if (confirm !== password) {
      next.confirm = "تکرار رمز عبور با رمز عبور واردشده یکسان نیست.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleActivate = () => {
    if (!validate()) return;
    activate.mutate(
      {
        username: username.trim().toLowerCase(),
        password,
        planCode: effectivePlan,
      },
      {
        onSuccess: () => toast.success("سرویس Drive فعال شد"),
        onError: (error) => {
          if (error instanceof ApiRequestError) {
            if (error.code === "INVALID_USERNAME") {
              setErrors((e) => ({ ...e, username: error.message }));
            } else if (error.code === "INVALID_PASSWORD" || error.code === "WEAK_PASSWORD") {
              setErrors((e) => ({ ...e, password: error.message }));
            } else if (error.code === "USERNAME_TAKEN") {
              setErrors((e) => ({ ...e, username: error.message }));
            }
            toast.error(errorMessage(error));
          } else {
            toast.error(errorMessage(error));
          }
        },
      },
    );
  };

  const entitledPlan = entitledPlanCode ? options.find((o) => o.code === entitledPlanCode) : null;

  return (
    <Reveal className="mx-auto max-w-2xl rounded-xl border bg-card p-6">
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary" aria-hidden="true">
          <Cloud className="size-7" />
        </span>
        <h2 className="mt-4 text-base font-extrabold">فعال‌سازی فضای ابری AbrIT Drive</h2>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          حساب Drive شما ساخته می‌شود؛ نام کاربری و رمز عبورِ ورود به Drive را انتخاب کنید.
          این اطلاعات مستقل از رمز عبور پنل کاربری شماست.
        </p>
        {pendingUsername && detail && <p className="mt-3 text-xs text-muted-foreground">{detail}</p>}
      </div>

      <div className="mt-6 space-y-4">
        <FormField
          label="نام کاربری Drive"
          htmlFor="drive-username"
          required
          error={errors.username ?? null}
          hint="۳ تا ۳۲ نویسه؛ حروف کوچک انگلیسی، رقم، نقطه و خط تیره"
        >
          <TextField
            id="drive-username"
            dir="ltr"
            placeholder="demo.user"
            autoComplete="off"
            className="text-center"
            value={username}
            invalid={Boolean(errors.username)}
            disabled={activate.isPending}
            onChange={(e) => {
              setUsername(e.target.value);
              if (errors.username) setErrors((p) => ({ ...p, username: undefined }));
            }}
          />
        </FormField>

        <FormField
          label="رمز عبور Drive"
          htmlFor="drive-password"
          required
          error={errors.password ?? null}
          hint="حداقل ۸ نویسه شامل حرف و رقم"
        >
          <div className="relative">
            <TextField
              id="drive-password"
              type={showPassword ? "text" : "password"}
              dir="ltr"
              autoComplete="new-password"
              className="pe-10"
              value={password}
              invalid={Boolean(errors.password)}
              disabled={activate.isPending}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent"
              aria-label={showPassword ? "پنهان کردن رمز" : "نمایش رمز"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </FormField>

        <FormField
          label="تکرار رمز عبور Drive"
          htmlFor="drive-confirm"
          required
          error={errors.confirm ?? null}
        >
          <TextField
            id="drive-confirm"
            type={showPassword ? "text" : "password"}
            dir="ltr"
            autoComplete="new-password"
            value={confirm}
            invalid={Boolean(errors.confirm)}
            disabled={activate.isPending}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (errors.confirm) setErrors((p) => ({ ...p, confirm: undefined }));
            }}
          />
        </FormField>

        {/* Plan selection */}
        <div className="space-y-1.5">
          <p className="text-xs font-bold">پلن و سهمیه اولیه</p>
          <RadioGroup
            value={effectivePlan}
            onValueChange={(v) => setPlanCode(v)}
            className="gap-2.5"
            aria-label="انتخاب پلن Drive"
            disabled={activate.isPending}
          >
            {entitledPlanCode && entitledPlan ? (
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-all",
                  effectivePlan === entitledPlanCode
                    ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                    : "border-border hover:border-primary/40 hover:bg-accent",
                )}
              >
                <RadioGroupItem value={entitledPlanCode} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-xs font-extrabold">
                    {entitledPlan.nameFa}
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[9px] font-bold text-success">
                      سهمیه پکیج شما
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {formatBytes(entitledPlan.quotaBytes)} فضای ابری
                  </span>
                </span>
              </label>
            ) : null}
            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-all",
                effectivePlan === "trial"
                  ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                  : "border-border hover:border-primary/40 hover:bg-accent",
              )}
            >
              <RadioGroupItem value="trial" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 text-xs font-extrabold">
                  آزمایشی
                  {!entitledPlanCode ? (
                    <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[9px] font-bold text-warning">
                      بدون اشتراک فعال، پلن آزمایشی ۱۰۰ مگابایتی فعال می‌شود
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  {formatBytes(TRIAL_QUOTA_BYTES)} فضای ابری — قابل ارتقا در هر زمان
                </span>
              </span>
            </label>
          </RadioGroup>
          {entitledPlanCode ? (
            <p className="flex items-start gap-1.5 text-[10px] leading-5 text-muted-foreground">
              <Info className="mt-0.5 size-3 shrink-0" />
              پلن «{planName(entitledPlanCode)}» مطابق اشتراک فعال شما به‌صورت پیش‌فرض انتخاب شده است.
            </p>
          ) : null}
        </div>

        {/* Honest pending state */}
        {activate.isPending ? (
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-4" role="status" aria-live="polite">
            <p className="flex items-center gap-2 text-xs font-extrabold text-primary">
              <Loader2 className="size-4 animate-spin" />
              در حال فعال‌سازی سرویس Drive…
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-primary/15">
              <div className="animate-indeterminate h-full w-1/3 rounded-full bg-primary" />
            </div>
            <ul className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-primary/60" aria-hidden="true" />
                بررسی نام کاربری — در حال انجام…
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-primary/60" aria-hidden="true" />
                ایجاد حساب روی سرور Drive — در حال انجام…
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-primary/60" aria-hidden="true" />
                اعمال سهمیه — در حال انجام…
              </li>
            </ul>
          </div>
        ) : (
          <Button className="h-11 w-full" onClick={handleActivate} disabled={activate.isPending}>
            <Sparkles className="size-4" />
            فعال‌سازی سرویس Drive
          </Button>
        )}

        <p className="flex items-start gap-1.5 text-[10px] leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3 shrink-0 text-success" />
          رمز عبور Drive مستقل از رمز پنل کاربری است و در پنل ذخیره نمی‌شود؛ آن را در جای امن نگه دارید.
        </p>
      </div>
    </Reveal>
  );
}

// ---------------------------------------------------------------------------
// Error states (unreachable / auth_failed / not_configured / missing_on_server)
// ---------------------------------------------------------------------------

const STATE_TITLES: Record<string, string> = {
  unreachable: "سرور AbrIT Drive در دسترس نیست",
  auth_failed: "اتصال به سرور Drive با خطای اعتبارنامه مواجه شد",
  not_configured: "سرویس Drive هنوز پیکربندی نشده است",
  missing_on_server: "حساب Drive شما روی سرور یافت نشد",
};

function DriveErrorState({ drive, onRetry }: { drive: DriveOverviewDTO; onRetry: () => void }) {
  return (
    <Reveal>
      <div
        role="alert"
        className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center"
      >
        <span
          className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
          aria-hidden="true"
        >
          <AlertTriangle className="size-6" />
        </span>
        <h2 className="mt-4 text-sm font-extrabold">
          {STATE_TITLES[drive.state] ?? "وضعیت Drive قابل دریافت نیست"}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-muted-foreground">
          {drive.detail ?? "وضعیت دقیق سرویس از سرور Drive دریافت نشد؛ لطفاً چند لحظه دیگر دوباره تلاش کنید."}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCcw className="size-3.5" />
            تلاش مجدد
          </Button>
          {drive.state === "missing_on_server" ? (
            <Button size="sm" asChild>
              <RouterLink to={routes.portalTickets} className="flex items-center gap-1.5">
                <LifeBuoy className="size-3.5" />
                با پشتیبانی تماس بگیرید
              </RouterLink>
            </Button>
          ) : null}
        </div>
      </div>
    </Reveal>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export default function DriveView() {
  const drive = useDriveOverview();
  const me = useMe();
  const data = drive.data;

  return (
    <>
      <PageHeader
        title="AbrIT Drive"
        description="فضای ابری سازمانی شما بر پایه Nextcloud"
        breadcrumbs={[{ label: "پنل کاربری", to: routes.portal }, { label: "AbrIT Drive" }]}
        actions={
          data ? (
            <Button variant="outline" size="sm" onClick={() => drive.refetch()} disabled={drive.isFetching}>
              <RefreshCcw className={cn("size-3.5", drive.isFetching && "animate-spin")} />
              به‌روزرسانی وضعیت
            </Button>
          ) : undefined
        }
      />

      {data?.mode === "simulation" ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[11px] leading-6 text-warning">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            این محیط به شبیه‌ساز Drive (نسخه نمایشی) متصل است؛ در محیط عملیاتی به{" "}
            <span className="ltr-iso font-bold" dir="ltr">drive.abrit.cloud</span> وصل می‌شود.
          </p>
        </div>
      ) : null}

      {drive.isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center" role="alert">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive" aria-hidden="true">
            <AlertTriangle className="size-6" />
          </span>
          <h2 className="mt-4 text-sm font-extrabold">وضعیت Drive قابل دریافت نیست</h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-muted-foreground">
            دریافت وضعیت سرویس از سرور انجام نشد. اتصال شبکه یا سرور را بررسی کنید و دوباره تلاش کنید.
          </p>
          <div className="mt-5">
            <Button size="sm" variant="outline" onClick={() => drive.refetch()}>
              <RefreshCcw className="size-3.5" />
              تلاش مجدد
            </Button>
          </div>
        </div>
      ) : !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
            <Skeleton className="h-96 w-full rounded-xl lg:col-span-3" />
            <Skeleton className="h-96 w-full rounded-xl lg:col-span-2" />
          </div>
        </div>
      ) : data.state === "ready" ? (
        <DriveReadyState drive={data} />
      ) : data.state === "not_provisioned" ? (
        <DriveActivationForm entitledPlanCode={me.data?.entitledPlanCode ?? null} pendingUsername={data.pendingUsername} detail={data.detail} />
      ) : (
        <DriveErrorState drive={data} onRetry={() => drive.refetch()} />
      )}
    </>
  );
}
