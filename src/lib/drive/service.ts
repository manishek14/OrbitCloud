// Drive orchestration service: links one panel user to one Nextcloud account,
// keeps an audit trail, and renders honest states (never fakes a connection).
//
// States surfaced to the panel:
//   not_provisioned  — panel user has no linked Drive account yet
//   ready             — linked; live status/usage from Nextcloud
//   missing_on_server — linked, but the account no longer exists in Nextcloud
//   unreachable       — Nextcloud did not answer (network/timeout)
//   auth_failed       — the integration credentials were rejected
//   not_configured    — the integration is off/missing settings (honest "not connected")

import { db } from "@/lib/db";
import type { PanelUser, DriveAccount, DriveEvent } from "@prisma/client";
import { getNextcloudConfig } from "@/lib/nextcloud/config";
import { nextcloudClient } from "@/lib/nextcloud/client";
import { NextcloudError } from "@/lib/nextcloud/errors";
import { getPlan, toHumanQuota, type DrivePlan } from "@/lib/drive/plans";
import { getEntitledPlan } from "@/lib/commerce/entitlement";

export type DriveServiceErrorCode =
  | "NOT_AUTHENTICATED"
  | "ALREADY_LINKED"
  | "USERNAME_TAKEN"
  | "INVALID_USERNAME"
  | "INVALID_PASSWORD"
  | "WEAK_PASSWORD"
  | "RECOVERY_REQUIRED"
  | "NC_AUTH_FAILED"
  | "NC_UNREACHABLE"
  | "PLAN_NOT_FOUND"
  | "NOT_LINKED"
  | "NC_ERROR";

const serviceMessages: Record<DriveServiceErrorCode, string> = {
  NOT_AUTHENTICATED: "برای این عملیات باید وارد پنل شوید.",
  ALREADY_LINKED: "برای این حساب کاربری، سرویس Drive قبلاً فعال شده است.",
  USERNAME_TAKEN: "این نام کاربری در AbrIT Drive قبلاً توسط حساب دیگری ثبت شده است.",
  INVALID_USERNAME:
    "نام کاربری Drive باید ۳ تا ۳۲ نویسه؛ فقط حروف کوچک انگلیسی، رقم و علامت‌های نقطه، خط تیره و زیرخط باشد و با حرف یا رقم شروع و پایان یابد.",
  INVALID_PASSWORD: "رمز عبور Drive باید حداقل ۸ نویسه و شامل حداقل یک حرف و یک رقم باشد.",
  WEAK_PASSWORD: "این رمز عبور رایج یا افشاشده است؛ رمز قوی و منحصربه‌فرد دیگری انتخاب کنید.",
  RECOVERY_REQUIRED: "ایجاد حساب Drive کامل نشده است. برای بررسی امن حساب با پشتیبانی تماس بگیرید.",
  NC_AUTH_FAILED: "اتصال Drive به دلیل رد شدن اعتبارنامه مدیر انجام نشد.",
  NC_UNREACHABLE: "سرور Drive در دسترس نیست؛ لطفاً بعداً دوباره تلاش کنید.",
  PLAN_NOT_FOUND: "پلن انتخابی معتبر نیست.",
  NOT_LINKED: "ابتدا سرویس Drive را برای حساب خود فعال کنید.",
  NC_ERROR: "عملیات روی سرور Drive انجام نشد.",
};

export class DriveServiceError extends Error {
  readonly code: DriveServiceErrorCode;
  readonly publicMessage: string;
  readonly httpStatus: number;
  readonly causeDetail?: string;

  constructor(
    code: DriveServiceErrorCode,
    options: { httpStatus?: number; publicMessage?: string; causeDetail?: string } = {},
  ) {
    super(serviceMessages[code]);
    this.name = "DriveServiceError";
    this.code = code;
    this.publicMessage = options.publicMessage ?? serviceMessages[code];
    this.httpStatus =
      options.httpStatus ??
      (code === "NOT_AUTHENTICATED" ? 401 : code === "USERNAME_TAKEN" || code === "RECOVERY_REQUIRED" ? 409 : code === "NOT_LINKED" ? 404 : 400);
    this.causeDetail = options.causeDetail;
  }
}

export type DriveState =
  | "not_provisioned"
  | "ready"
  | "missing_on_server"
  | "unreachable"
  | "auth_failed"
  | "not_configured";

export interface DriveUsage {
  usedBytes: number;
  totalBytes: number;
  freeBytes: number;
  relative: number; // 0..1
  unlimited: boolean;
}

export interface DriveAccountDTO {
  ncUsername: string;
  ncEmail: string | null;
  ncDisplayName: string | null;
  planCode: string;
  planNameFa: string;
  quotaLabel: string;
  quotaBytes: number;
  status: "active" | "disabled";
  provisionedAt: string;
  lastSyncedAt: string | null;
}

export interface DriveEventDTO {
  id: string;
  type: string;
  detail: string | null;
  createdAt: string;
}

export interface DriveOverview {
  mode: "live" | "simulation";
  state: DriveState;
  detail: string | null;
  pendingUsername?: string;
  account: DriveAccountDTO | null;
  usage: DriveUsage | null;
  loginUrl: string;
  loginUrlLabel: string;
  events: DriveEventDTO[];
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const NC_USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;

export function validateNcUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!NC_USERNAME_RE.test(normalized)) {
    throw new DriveServiceError("INVALID_USERNAME");
  }
  return normalized;
}

export function validateNcPassword(password: string): string {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new DriveServiceError("INVALID_PASSWORD");
  }
  if (!/[A-Za-zآ-ی]/.test(password) || !/[0-9]/.test(password)) {
    throw new DriveServiceError("INVALID_PASSWORD");
  }
  return password;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const statusCache = new Map<string, { expiresAt: number; user: NonNullable<Awaited<ReturnType<typeof nextcloudClient.getUser>>> }>();
const STATUS_CACHE_MS = 30_000;

function cacheKey(userId: string): string {
  return `abrit-drive:${userId}`;
}

function clearStatusCache(userId: string): void {
  statusCache.delete(cacheKey(userId));
}

function ncErrorToState(error: NextcloudError): { state: DriveState; detail: string } {
  switch (error.code) {
    case "NC_UNREACHABLE":
      return { state: "unreachable", detail: "سرور Drive در دسترس نیست؛ چند لحظه بعد دوباره تلاش کنید." };
    case "NC_AUTH_FAILED":
      return { state: "auth_failed", detail: "اعتبارنامه اتصال Drive پذیرفته نشد؛ با مدیر پنل تماس بگیرید." };
    case "NC_NOT_CONFIGURED":
      return { state: "not_configured", detail: "اتصال AbrIT Drive برای این محیط پیکربندی نشده است." };
    default:
      return { state: "unreachable", detail: "پاسخ نامعتبر از سرور Drive." };
  }
}

async function logEvent(
  accountId: string,
  type: "provisioned" | "resumed" | "quota_changed" | "enabled" | "disabled" | "sync" | "error",
  detail: string | null,
): Promise<void> {
  await db.driveEvent.create({ data: { accountId, type, detail } }).catch(() => undefined);
}

async function planFor(planCode: string, userId?: string): Promise<DrivePlan> {
  const plan = await getPlan(planCode);
  if (!plan) throw new DriveServiceError("PLAN_NOT_FOUND");
  if (userId && planCode !== "trial") {
    const entitlement = await getEntitledPlan(userId);
    if (!entitlement || entitlement.code !== planCode) throw new DriveServiceError("PLAN_NOT_FOUND");
    return { ...plan, quotaBytes: entitlement.quotaBytes };
  }
  return plan;
}

async function toAccountDTO(account: DriveAccount): Promise<DriveAccountDTO> {
  const plan = await getPlan(account.planCode);
  return {
    ncUsername: account.ncUsername,
    ncEmail: account.ncEmail,
    ncDisplayName: account.ncDisplayName,
    planCode: account.planCode,
    planNameFa: plan?.nameFa ?? account.planCode,
    quotaLabel: toHumanQuota(Number(account.quotaBytes)),
    quotaBytes: Number(account.quotaBytes),
    status: account.status === "disabled" ? "disabled" : "active",
    provisionedAt: account.provisionedAt.toISOString(),
    lastSyncedAt: account.lastSyncedAt ? account.lastSyncedAt.toISOString() : null,
  };
}

function usageFromNc(ncUser: NonNullable<Awaited<ReturnType<typeof nextcloudClient.getUser>>>): DriveUsage {
  const unlimited = ncUser.quota.quota === -3;
  const totalBytes = unlimited ? Number.MAX_SAFE_INTEGER : ncUser.quota.total;
  const usedBytes = Math.max(0, ncUser.quota.used);
  const freeBytes = unlimited ? Math.max(0, ncUser.quota.free) : Math.max(0, totalBytes - usedBytes);
  const relative = totalBytes > 0 ? Math.min(1, usedBytes / totalBytes) : 0;
  return { usedBytes, totalBytes: unlimited ? -1 : totalBytes, freeBytes, relative, unlimited };
}

async function fetchNcUser(
  ncUsername: string,
  userId: string,
  bypassCache: boolean,
): Promise<{ ok: true; user: NonNullable<Awaited<ReturnType<typeof nextcloudClient.getUser>>> } | { ok: false; error: NextcloudError }> {
  const key = cacheKey(userId);
  const cached = statusCache.get(key);
  if (!bypassCache && cached && cached.expiresAt > Date.now()) {
    return { ok: true, user: cached.user };
  }
  try {
    const user = await nextcloudClient.getUser(ncUsername);
    if (!user) return { ok: false, error: new NextcloudError("NC_NOT_FOUND") };
    statusCache.set(key, { expiresAt: Date.now() + STATUS_CACHE_MS, user });
    return { ok: true, user };
  } catch (error) {
    if (error instanceof NextcloudError) return { ok: false, error };
    return { ok: false, error: new NextcloudError("NC_ERROR", { rawDetail: String(error) }) };
  }
}

async function loadEvents(accountId: string): Promise<DriveEventDTO[]> {
  const events: DriveEvent[] = await db.driveEvent.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return events.map((e) => ({ id: e.id, type: e.type, detail: e.detail, createdAt: e.createdAt.toISOString() }));
}

function baseOverview(mode: "live" | "simulation"): Pick<DriveOverview, "mode" | "loginUrl" | "loginUrlLabel" | "fetchedAt"> {
  const config = getNextcloudConfig();
  return {
    mode,
    loginUrl: config.loginUrl,
    loginUrlLabel: mode === "live" ? "ورود به AbrIT Drive" : "ورود به AbrIT Drive (شبیه‌سازی)",
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public service API
// ---------------------------------------------------------------------------

export const driveService = {
  /** Full dashboard overview for a panel user. */
  async getOverview(user: PanelUser, options: { bypassCache?: boolean } = {}): Promise<DriveOverview> {
    const config = getNextcloudConfig();
    const base = baseOverview(config.mode);
    const account = await db.driveAccount.findUnique({
      where: { panelUserId: user.id },
      include: { events: false },
    });

    if (!account) {
      return {
        ...base,
        state: "not_provisioned",
        detail: null,
        account: null,
        usage: null,
        events: [],
      };
    }

    if (account.status === "provisioning" || account.status === "provisioning_created") {
      return {
        ...base,
        state: "not_provisioned",
        detail: account.status === "provisioning"
          ? "فعال‌سازی Drive کامل نشده است؛ با همین نام کاربری و یک رمز عبور جدید دوباره تلاش کنید."
          : "حساب Drive ساخته شده اما فعال‌سازی کامل نشده است؛ با همین نام کاربری و رمز عبور جدید دوباره تلاش کنید. پس از تکمیل فعال‌سازی، همین رمز جدید روی حساب اعمال می‌شود.",
        pendingUsername: account.ncUsername,
        account: null,
        usage: null,
        events: [],
      };
    }

    if (!config.configured) {
      return {
        ...base,
        state: "not_configured",
        detail: "اتصال AbrIT Drive برای این محیط پیکربندی نشده است.",
        account: await toAccountDTO(account),
        usage: null,
        events: await loadEvents(account.id),
      };
    }

    const result = await fetchNcUser(account.ncUsername, user.id, Boolean(options.bypassCache));
    if (!result.ok) {
      if (result.error.code === "NC_NOT_FOUND") {
        return {
          ...base,
          state: "missing_on_server",
          detail: "حساب Drive این کاربر در سرور یافت نشد؛ با پشتیبانی تماس بگیرید.",
          account: await toAccountDTO(account),
          usage: null,
          events: await loadEvents(account.id),
        };
      }
      const mapped = ncErrorToState(result.error);
      return {
        ...base,
        state: mapped.state,
        detail: mapped.detail,
        account: await toAccountDTO(account),
        usage: null,
        events: await loadEvents(account.id),
      };
    }

    const ncUser = result.user;
    // Reflect the authoritative server state (enabled/disabled) without a DB write storm.
    if ((account.status === "active") !== ncUser.enabled) {
      await db.driveAccount
        .update({
          where: { id: account.id },
          data: { status: ncUser.enabled ? "active" : "disabled" },
        })
        .catch(() => undefined);
    }
    await db.driveAccount
      .update({ where: { id: account.id }, data: { lastSyncedAt: new Date() } })
      .catch(() => undefined);

    return {
      ...base,
      state: "ready",
      detail: null,
      account: { ...await toAccountDTO(account), status: ncUser.enabled ? "active" : "disabled" },
      usage: usageFromNc(ncUser),
      events: await loadEvents(account.id),
    };
  },

  /**
   * Idempotent provisioning:
   *  1. validate inputs (username, password, plan)
   *  2. refuse when the panel user already has an account (no duplicates)
   *  3. refuse when the Nextcloud username belongs to someone else
   *  4. reserve the username in PostgreSQL before creating it remotely
   *  5. resume only a reservation that recorded successful remote creation
   */
  async activate(
    user: PanelUser,
    input: { username: string; password: string; planCode: string },
  ): Promise<DriveOverview> {
    const ncUsername = validateNcUsername(input.username);
    const ncPassword = validateNcPassword(input.password);
    const plan = await planFor(input.planCode, user.id);

    const existingAccount = await db.driveAccount.findFirst({
      where: { OR: [{ panelUserId: user.id }, { ncUsername }] },
    });
    if (existingAccount) {
      if (existingAccount.panelUserId !== user.id) {
        throw new DriveServiceError("USERNAME_TAKEN", { httpStatus: 409 });
      }
      if (existingAccount.ncUsername !== ncUsername || existingAccount.planCode !== plan.code) {
        throw new DriveServiceError("RECOVERY_REQUIRED", {
          causeDetail: "Activation retry must use the reserved username and plan.",
        });
      }
      if (existingAccount.status !== "provisioning" && existingAccount.status !== "provisioning_created") {
        throw new DriveServiceError("ALREADY_LINKED", { httpStatus: 409 });
      }
    }

    const config = getNextcloudConfig();
    if (!config.configured) {
      throw new DriveServiceError("NC_ERROR", {
        httpStatus: 503,
        publicMessage: "اتصال AbrIT Drive هنوز پیکربندی نشده است.",
      });
    }

    // Does the username already exist on the Drive server?
    let existingNcUser: Awaited<ReturnType<typeof nextcloudClient.getUser>> = null;
    try {
      existingNcUser = await nextcloudClient.getUser(ncUsername);
    } catch (error) {
      if (error instanceof NextcloudError && (error.code === "NC_UNREACHABLE" || error.code === "NC_AUTH_FAILED" || error.code === "NC_NOT_CONFIGURED")) {
        throw new DriveServiceError(error.code === "NC_NOT_CONFIGURED" ? "NC_ERROR" : error.code, {
          httpStatus: error.httpStatus,
          publicMessage: ncErrorToState(error).detail,
          causeDetail: error.rawDetail,
        });
      }
      throw new DriveServiceError("NC_ERROR", {
        publicMessage: "بررسی وضعیت سرور Drive انجام نشد.",
        causeDetail: error instanceof NextcloudError ? error.rawDetail : String(error),
      });
    }

    // A pending reservation cannot prove ownership of a remote user: creation
    // might have raced with another actor or succeeded before a DB outage.
    if (existingNcUser && existingAccount?.status !== "provisioning_created") {
      throw new DriveServiceError(existingAccount ? "RECOVERY_REQUIRED" : "USERNAME_TAKEN");
    }
    if (!existingNcUser && existingAccount?.status === "provisioning_created") {
      throw new DriveServiceError("RECOVERY_REQUIRED", { causeDetail: "Previously created Nextcloud user is missing." });
    }
    if (existingNcUser && existingAccount?.status === "provisioning_created" &&
        (existingNcUser.id !== ncUsername || existingNcUser.email?.toLowerCase() !== user.email.toLowerCase())) {
      throw new DriveServiceError("RECOVERY_REQUIRED", { causeDetail: "Previously created Nextcloud user identity changed." });
    }

    const resumed = existingAccount?.status === "provisioning_created";
    let reservation = existingAccount;
    if (!reservation) {
      try {
        reservation = await db.driveAccount.create({
          data: {
            panelUserId: user.id,
            ncUsername,
            ncEmail: user.email,
            ncDisplayName: user.name?.trim() || ncUsername,
            planCode: plan.code,
            quotaBytes: BigInt(plan.quotaBytes),
            status: "provisioning",
          },
        });
      } catch {
        throw new DriveServiceError("NC_ERROR", { causeDetail: "Unable to reserve Drive account in PostgreSQL." });
      }
    }
    if (!resumed) {
      try {
        await nextcloudClient.createUser({
          userid: ncUsername,
          password: ncPassword,
          email: user.email,
        });
        await db.driveAccount.update({ where: { id: reservation.id }, data: { status: "provisioning_created" } });
      } catch (error) {
        if (error instanceof NextcloudError) {
          if (error.code === "NC_USER_EXISTS") {
            throw new DriveServiceError("RECOVERY_REQUIRED", { causeDetail: error.rawDetail });
          } else if (error.code === "NC_WEAK_PASSWORD") {
            throw new DriveServiceError("WEAK_PASSWORD", { causeDetail: error.rawDetail });
          } else if (error.code === "NC_INVALID_PASSWORD") {
            throw new DriveServiceError("INVALID_PASSWORD", {
              publicMessage: "رمز عبور انتخابی با سیاست امنیتی Drive سازگار نیست؛ رمز قوی‌تری انتخاب کنید.",
              causeDetail: error.rawDetail,
            });
          } else if (error.code === "NC_INVALID_USERNAME") {
            throw new DriveServiceError("INVALID_USERNAME", { causeDetail: error.rawDetail });
          } else if (error.code === "NC_UNREACHABLE" || error.code === "NC_AUTH_FAILED" || error.code === "NC_NOT_CONFIGURED") {
            throw new DriveServiceError(error.code === "NC_NOT_CONFIGURED" ? "NC_ERROR" : error.code, {
              httpStatus: error.httpStatus,
              publicMessage: ncErrorToState(error).detail,
              causeDetail: error.rawDetail,
            });
          } else {
            throw new DriveServiceError("NC_ERROR", {
              publicMessage: "ایجاد حساب در سرور Drive انجام نشد.",
              causeDetail: error.rawDetail,
            });
          }
        } else {
          throw new DriveServiceError("NC_ERROR", {
            publicMessage: "ایجاد حساب در سرور Drive انجام نشد.",
            causeDetail: String(error),
          });
        }
      }
    }

    // Align account fields (also covers versions that ignore email at creation).
    const repairOps: Array<Promise<void>> = [];
    if (!existingNcUser || (existingNcUser.email ?? "") !== user.email) {
      repairOps.push(nextcloudClient.editUser(ncUsername, "email", user.email).catch(() => undefined));
    }
    const displayName = user.name?.trim() || ncUsername;
    if (!existingNcUser || (existingNcUser.displayname ?? "") !== displayName) {
      repairOps.push(nextcloudClient.editUser(ncUsername, "displayname", displayName).catch(() => undefined));
    }
    // Password synchronization on RESUME (audit §5.1): ownership of the
    // remote account was verified above (matching userid AND panel email on
    // a provisioning_created reservation). The user explicitly chose a new
    // password in this retry — apply it so the credentials the user sees are
    // the credentials that work. A pending `provisioning` reservation never
    // reaches this branch (createUser just ran with this password instead).
    if (resumed) {
      repairOps.push(nextcloudClient.editUser(ncUsername, "password", ncPassword));
    }
    repairOps.push(nextcloudClient.setQuota(ncUsername, toHumanQuota(plan.quotaBytes)));
    try {
      await Promise.all(repairOps);
    } catch (error) {
      throw new DriveServiceError("NC_ERROR", {
        publicMessage:
          "حساب موجود یافت شد اما همگام‌سازی رمز عبور/سهمیه انجام نشد؛ لطفاً دوباره فعال‌سازی کنید.",
        causeDetail: error instanceof NextcloudError ? error.rawDetail : String(error),
      });
    }

    const verified = await nextcloudClient.getUser(ncUsername);
    if (!verified || verified.id !== ncUsername || verified.quota.quota !== plan.quotaBytes) {
      throw new DriveServiceError("NC_ERROR", { causeDetail: "Nextcloud user or quota verification failed." });
    }
    try {
      await db.driveAccount.update({
        where: { id: reservation.id },
        data: {
          status: "active",
          lastSyncedAt: new Date(),
          events: { create: { type: resumed ? "resumed" : "provisioned", detail: `Drive quota ${toHumanQuota(plan.quotaBytes)}` } },
        },
      });
    } catch {
      throw new DriveServiceError("NC_ERROR", { causeDetail: "Unable to finalize Drive account in PostgreSQL." });
    }
    clearStatusCache(user.id);
    return this.getOverview(user, { bypassCache: true });
  },

  /** Change the assigned quota (plan change) — applies to Nextcloud immediately. */
  async changeQuota(user: PanelUser, planCode: string, manual = false): Promise<DriveOverview> {
    const plan = await planFor(planCode, manual ? undefined : user.id);
    const account = await db.driveAccount.findUnique({ where: { panelUserId: user.id } });
    if (!account) throw new DriveServiceError("NOT_LINKED");

    try {
      await nextcloudClient.setQuota(account.ncUsername, toHumanQuota(plan.quotaBytes));
    } catch (error) {
      throw new DriveServiceError("NC_ERROR", {
        httpStatus: 502,
        publicMessage:
          error instanceof NextcloudError && (error.code === "NC_UNREACHABLE" || error.code === "NC_AUTH_FAILED")
            ? ncErrorToState(error).detail
            : "تغییر سهمیه در سرور Drive انجام نشد.",
        causeDetail: error instanceof NextcloudError ? error.rawDetail : String(error),
      });
    }

    await db.driveAccount.update({
      where: { id: account.id },
      data: { planCode: plan.code, quotaBytes: BigInt(plan.quotaBytes), lastSyncedAt: new Date() },
    });
    await logEvent(
      account.id,
      "quota_changed",
      `از ${(await getPlan(account.planCode))?.nameFa ?? account.planCode} به ${plan.nameFa} — سهمیه ${toHumanQuota(plan.quotaBytes)}`,
    );
    clearStatusCache(user.id);
    return this.getOverview(user, { bypassCache: true });
  },

  /** Enable or disable the Drive account (disabled users cannot log in). */
  async setEnabled(user: PanelUser, enabled: boolean): Promise<DriveOverview> {
    const account = await db.driveAccount.findUnique({ where: { panelUserId: user.id } });
    if (!account) throw new DriveServiceError("NOT_LINKED");

    try {
      await nextcloudClient.setUserEnabled(account.ncUsername, enabled);
    } catch (error) {
      throw new DriveServiceError("NC_ERROR", {
        httpStatus: 502,
        publicMessage:
          error instanceof NextcloudError && (error.code === "NC_UNREACHABLE" || error.code === "NC_AUTH_FAILED")
            ? ncErrorToState(error).detail
            : enabled
              ? "فعال‌سازی حساب در سرور Drive انجام نشد."
              : "غیرفعال‌سازی حساب در سرور Drive انجام نشد.",
        causeDetail: error instanceof NextcloudError ? error.rawDetail : String(error),
      });
    }

    await db.driveAccount.update({
      where: { id: account.id },
      data: { status: enabled ? "active" : "disabled", lastSyncedAt: new Date() },
    });
    await logEvent(account.id, enabled ? "enabled" : "disabled", enabled ? "حساب فعال شد." : "حساب غیرفعال شد.");
    clearStatusCache(user.id);
    return this.getOverview(user, { bypassCache: true });
  },

  /** Force a fresh status/usage read from Nextcloud (bypasses the cache). */
  async sync(user: PanelUser): Promise<DriveOverview> {
    const account = await db.driveAccount.findUnique({ where: { panelUserId: user.id } });
    if (!account) throw new DriveServiceError("NOT_LINKED");
    clearStatusCache(user.id);
    const overview = await this.getOverview(user, { bypassCache: true });
    if (overview.state === "ready") {
      await logEvent(account.id, "sync", `همگام‌سازی — ${overview.usage?.usedBytes ?? 0} بایت مصرف`);
      overview.events = await loadEvents(account.id);
    }
    return overview;
  },

  // -------------------------------------------------------------------------
  // Admin (staff) operations — act on a customer's account by id.
  // -------------------------------------------------------------------------

  /** All Drive accounts with customer info (admin provisioning screen). */
  async adminListAccounts() {
    const accounts = await db.driveAccount.findMany({
      orderBy: { provisionedAt: "desc" },
      // Bounded operational window (audit §3.3).
      take: 500,
      include: { panelUser: { select: { id: true, email: true, name: true } }, events: { select: { id: true } } },
    });
    return Promise.all(accounts.map(async (a) => ({
      id: a.id,
      customer: a.panelUser ? { id: a.panelUser.id, email: a.panelUser.email, name: a.panelUser.name } : null,
      ncUsername: a.ncUsername,
      ncDisplayName: a.ncDisplayName,
      planCode: a.planCode,
      planNameFa: (await getPlan(a.planCode))?.nameFa ?? a.planCode,
      quotaBytes: Number(a.quotaBytes),
      status: a.status === "disabled" ? ("disabled" as const) : ("active" as const),
      provisionedAt: a.provisionedAt.toISOString(),
      lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
      eventCount: a.events.length,
    })));
  },

  async adminGetOwner(accountId: string): Promise<PanelUser> {
    const account = await db.driveAccount.findUnique({
      where: { id: accountId },
      include: { panelUser: true },
    });
    if (!account || !account.panelUser) throw new DriveServiceError("NOT_LINKED");
    return account.panelUser;
  },

  async adminSetEnabled(accountId: string, enabled: boolean): Promise<DriveOverview> {
    const owner = await this.adminGetOwner(accountId);
    return this.setEnabled(owner, enabled);
  },

  async adminSync(accountId: string): Promise<DriveOverview> {
    const owner = await this.adminGetOwner(accountId);
    return this.sync(owner);
  },

  async adminChangeQuota(accountId: string, planCode: string): Promise<DriveOverview> {
    const owner = await this.adminGetOwner(accountId);
    return this.changeQuota(owner, planCode, true);
  },

  /**
   * Operator recovery path for stuck provisioning states (audit §5.2).
   *
   * Safe, minimal, verifiable un-stick for the two reservation states:
   *   • provisioning_created + remote user EXISTS and is owned by this panel
   *     user (userid + email match) → keep the reservation, keep status
   *     provisioning_created. The owner can then retry activation themselves;
   *     the retry applies their newly chosen password (see activate()).
   *   • remote user MISSING → downgrade the reservation to `provisioning`
   *     so the owner's next attempt performs a clean remote createUser.
   *
   * Never deletes reservations, never adopts a remote account whose email
   * does not match the owner, never touches accounts already active. Every
   * decision is recorded as a DriveEvent for the operator audit trail.
   */
  async adminResetProvisioning(accountId: string): Promise<{ ok: true; action: "kept_created" | "downgraded_to_provisioning"; message: string }> {
    const account = await db.driveAccount.findUnique({
      where: { id: accountId },
      include: { panelUser: true },
    });
    if (!account || !account.panelUser) throw new DriveServiceError("NOT_LINKED");
    if (account.status !== "provisioning" && account.status !== "provisioning_created") {
      throw new DriveServiceError("ALREADY_LINKED", {
        publicMessage: "این حساب در وضعیت فعال‌سازی ناتمام نیست؛ بازنشانی فقط برای رزروهای ناتمام معتبر است.",
      });
    }

    let remoteUser: Awaited<ReturnType<typeof nextcloudClient.getUser>> = null;
    try {
      remoteUser = await nextcloudClient.getUser(account.ncUsername);
    } catch (error) {
      // Unreachable/auth-failed remote → NOT safe to decide anything.
      throw new DriveServiceError(
        error instanceof NextcloudError && (error.code === "NC_UNREACHABLE" || error.code === "NC_AUTH_FAILED") ? error.code : "NC_ERROR",
        {
          httpStatus: 502,
          publicMessage: "وضعیت سرور Drive در دسترس نیست؛ تصمیم بازنشانی ممکن نیست.",
          causeDetail: error instanceof NextcloudError ? error.rawDetail : String(error),
        },
      );
    }

    if (remoteUser) {
      const owned =
        remoteUser.id === account.ncUsername &&
        remoteUser.email?.toLowerCase() === account.panelUser.email.toLowerCase();
      if (!owned) {
        await logEvent(account.id, "error", "بازنشانی رد شد: حساب ریموت متعلق به این کاربر نیست (ایمیل/نام کاربری متفاوت).");
        throw new DriveServiceError("RECOVERY_REQUIRED", {
          causeDetail: "Remote account exists but is not owned by the reservation owner.",
          publicMessage: "حساب ریموت یافت شد اما متعلق به این مشتری نیست؛ بازنشانی خودکار ممکن نیست.",
        });
      }
      await db.driveAccount.update({
        where: { id: account.id },
        data: { status: "provisioning_created", lastSyncedAt: new Date() },
      });
      await logEvent(account.id, "resumed", "بازنشانی عملیاتی: رزرو در وضعیت «ایجادشده در سرور» نگه داشته شد؛ مالک می‌تواند فعال‌سازی را با رمز جدید تکمیل کند.");
      return {
        ok: true,
        action: "kept_created",
        message: "حساب ریموت متعلق به مشتری تأیید شد؛ رزرو در وضعیت تکمیل‌شدنی نگه داشته شد. مشتری می‌تواند با همان نام کاربری و رمز جدید فعال‌سازی را کامل کند.",
      };
    }

    await db.driveAccount.update({
      where: { id: account.id },
      data: { status: "provisioning", lastSyncedAt: new Date() },
    });
    await logEvent(account.id, "resumed", "بازنشانی عملیاتی: حساب ریموت یافت نشد؛ رزرو به وضعیت «در انتظار ایجاد» بازگشت.");
    return {
      ok: true,
      action: "downgraded_to_provisioning",
      message: "حساب ریموت یافت نشد؛ رزرو به وضعیت ایجاد مجاز بازگشت. مشتری می‌تواند فعال‌سازی را از نو انجام دهد.",
    };
  },
};
