// Nextcloud OCS (User Provisioning API) client — server-side only.
//
// Endpoint reference: https://docs.nextcloud.com/server/stable/admin_manual/configuration_user/user_provisioning_api.html
//   POST   /ocs/v1.php/cloud/users              create user (userid, password, ...)
//   GET    /ocs/v1.php/cloud/users/<userid>      user details incl. quota/usage
//   GET    /ocs/v1.php/cloud/users?search=       search users
//   PUT    /ocs/v1.php/cloud/users/<userid>      edit fields (key=quota|email|displayname|password)
//   PUT    /ocs/v1.php/cloud/users/<userid>/enable | /disable
//
// Every call requires: Basic auth (admin), "OCS-APIRequest: true", Accept: application/json.

import { getNextcloudConfig, type NextcloudConfig } from "./config";
import { NextcloudError, isNextcloudError } from "./errors";
import type { NextcloudUser, OcsEnvelope, NextcloudQuota } from "./types";

const USER_AGENT = "AbrITPortal-DriveIntegration/1.0 (Nextcloud OCS client)";

function ocsUrl(config: NextcloudConfig, path: string): string {
  return `${config.baseUrl}/ocs/v1.php/cloud${path}`;
}

function authHeader(config: NextcloudConfig): string {
  return "Basic " + Buffer.from(`${config.adminUser}:${config.adminPassword}`).toString("base64");
}

function baseHeaders(config: NextcloudConfig): HeadersInit {
  return {
    Authorization: authHeader(config),
    "OCS-APIRequest": "true",
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
}

interface RawCallResult<T> {
  httpStatus: number;
  meta?: { status: string; statuscode: number; message: string };
  data?: T;
  parseError: boolean;
}

async function rawCall<T>(
  url: string,
  init: RequestInit,
  config: NextcloudConfig,
  method: string,
): Promise<RawCallResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(config.timeoutMs),
      // Basic credentials never travel over plain HTTP in live mode.
    });
  } catch (error) {
    const reason =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
        ? "timeout"
        : "network";
    throw new NextcloudError("NC_UNREACHABLE", {
      rawDetail: `Nextcloud ${method} ${url} failed (${reason})`,
    });
  }

  const text = await response.text().catch(() => "");
  let meta: RawCallResult<T>["meta"];
  let data: T | undefined;
  let parseError = false;
  if (text) {
    try {
      const parsed = JSON.parse(text) as OcsEnvelope<T> | { message?: string };
      if ("ocs" in parsed && parsed.ocs && parsed.ocs.meta) {
        meta = {
          status: String(parsed.ocs.meta.status ?? "failure"),
          statuscode: Number(parsed.ocs.meta.statuscode ?? 0),
          message: String(parsed.ocs.meta.message ?? ""),
        };
        data = parsed.ocs.data;
      } else if ("message" in parsed) {
        // Non-OCS JSON error (e.g. 401 from the web layer).
        meta = { status: "failure", statuscode: 0, message: String(parsed.message) };
      } else {
        parseError = true;
      }
    } catch {
      parseError = true;
    }
  } else {
    parseError = true;
  }

  if (response.status === 401 || response.status === 403) {
    throw new NextcloudError("NC_AUTH_FAILED", {
      rawDetail: `Nextcloud ${method} ${url} rejected the credentials (HTTP ${response.status}).`,
    });
  }

  return { httpStatus: response.status, meta, data, parseError };
}

function ensureConfigured(config: NextcloudConfig): void {
  if (!config.configured) {
    throw new NextcloudError("NC_NOT_CONFIGURED", {
      rawDetail:
        config.mode === "live"
          ? "Live mode requires NEXTCLOUD_BASE_URL (https), NEXTCLOUD_ADMIN_USER and NEXTCLOUD_ADMIN_APP_PASSWORD."
          : "Simulation service is not configured.",
    });
  }
}

function toQuota(raw: unknown): NextcloudQuota {
  const q = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const quotaLimit = num(q.quota, -3);
  return {
    free: num(q.free),
    used: num(q.used),
    total: num(q.total),
    relative: num(q.relative),
    quota: quotaLimit,
  };
}

export interface CreateUserData {
  userid: string;
  password: string;
  email?: string | null;
  groups?: string[];
}

export const nextcloudClient = {
  config(): NextcloudConfig {
    return getNextcloudConfig();
  },

  /** Cheap unauthenticated reachability probe (Nextcloud /status.php). */
  async ping(): Promise<{ version: string; productname: string }> {
    const config = getNextcloudConfig();
    ensureConfigured(config);
    try {
      const response = await fetch(`${config.baseUrl}/status.php`, {
        signal: AbortSignal.timeout(config.timeoutMs),
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
      if (!response.ok) {
        throw new NextcloudError("NC_UNREACHABLE", {
          rawDetail: `Nextcloud ping returned HTTP ${response.status}.`,
        });
      }
      const body = (await response.json()) as { versionstring?: string; productname?: string };
      return { version: String(body.versionstring ?? ""), productname: String(body.productname ?? "Nextcloud") };
    } catch (error) {
      if (isNextcloudError(error)) throw error;
      throw new NextcloudError("NC_UNREACHABLE", { rawDetail: "Nextcloud ping failed (network)." });
    }
  },

  /** Full user details; null when the user does not exist. */
  async getUser(userid: string): Promise<NextcloudUser | null> {
    const config = getNextcloudConfig();
    ensureConfigured(config);
    const result = await rawCall<Record<string, unknown>>(
      ocsUrl(config, `/users/${encodeURIComponent(userid)}`),
      { method: "GET", headers: baseHeaders(config) },
      config,
      "GET",
    );
    // Nextcloud versions report a missing user as OCS 998 or OCS 404,
    // sometimes inside an HTTP 200 response. A plain HTTP 404 may instead
    // mean that the OCS route is wrong, so require the OCS user message.
    const missingUser = result.meta?.status === "failure" &&
      (result.meta.statuscode === 404 || result.meta.statuscode === 998) &&
      /^(?:User does not exist|The requested user could not be found)$/i.test(result.meta.message.trim());
    if (missingUser && (result.httpStatus === 200 || result.httpStatus === 404)) return null;
    if (result.httpStatus < 200 || result.httpStatus >= 300) {
      throw new NextcloudError("NC_ERROR", {
        rawDetail: `Nextcloud GET user failed: HTTP ${result.httpStatus}, OCS ${result.meta?.statuscode ?? "missing"} ${result.meta?.message ?? ""}`,
        ocsStatuscode: result.meta?.statuscode,
      });
    }
    if (result.meta?.statuscode === 997 && result.meta.status !== "ok") {
      throw new NextcloudError("NC_AUTH_FAILED", { ocsStatuscode: 997, rawDetail: "Nextcloud GET user rejected the credentials (OCS 997)." });
    }
    if (result.meta && result.meta.status !== "ok") {
      throw new NextcloudError("NC_ERROR", {
        rawDetail: `Nextcloud GET user failed: ${result.meta.statuscode} ${result.meta.message}`,
        ocsStatuscode: result.meta.statuscode,
      });
    }
    if (result.parseError || !result.data) {
      throw new NextcloudError("NC_ERROR", { rawDetail: "Nextcloud GET user returned an unparseable body." });
    }
    const d = result.data;
    return {
      id: String(d.id ?? userid),
      enabled: d.enabled !== false,
      email: d.email ? String(d.email) : null,
      displayname: d.displayname ? String(d.displayname) : null,
      quota: toQuota(d.quota),
      lastLoginAt: d.lastLoginAt ? Number(d.lastLoginAt) : null,
      createdAt: d.createdAt ? Number(d.createdAt) : null,
    };
  },

  async searchUsers(term: string): Promise<string[]> {
    const config = getNextcloudConfig();
    ensureConfigured(config);
    const result = await rawCall<unknown>(
      `${ocsUrl(config, "/users")}?search=${encodeURIComponent(term)}`,
      { method: "GET", headers: baseHeaders(config) },
      config,
      "GET",
    );
    if (result.meta && result.meta.status !== "ok") return [];
    if (Array.isArray(result.data)) return result.data.map((x) => String(x));
    return [];
  },

  async createUser(input: CreateUserData): Promise<{ userid: string }> {
    const config = getNextcloudConfig();
    ensureConfigured(config);
    const body = new URLSearchParams({ userid: input.userid, password: input.password });
    if (input.email) body.set("email", input.email);
    if (input.groups?.length) input.groups.forEach((g) => body.append("groups[]", g));
    const result = await rawCall<Record<string, unknown>>(
      ocsUrl(config, "/users"),
      {
        method: "POST",
        headers: { ...baseHeaders(config), "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      config,
      "POST",
    );
    if (result.httpStatus >= 200 && result.httpStatus < 300 && result.meta?.status === "ok") {
      return { userid: String(result.data?.id ?? input.userid) };
    }
    const statuscode = result.meta?.statuscode ?? result.httpStatus;
    const raw = `Nextcloud POST user failed: ${statuscode} ${result.meta?.message ?? ""} (HTTP ${result.httpStatus}, parseError=${result.parseError})`;
    switch (statuscode) {
      case 101:
        throw new NextcloudError("NC_INVALID_USERNAME", { rawDetail: raw, ocsStatuscode: 101 });
      case 102:
        throw new NextcloudError("NC_INVALID_PASSWORD", { rawDetail: raw, ocsStatuscode: 102 });
      case 107:
        throw new NextcloudError("NC_WEAK_PASSWORD", { rawDetail: raw, ocsStatuscode: 107 });
      case 103:
        throw new NextcloudError("NC_USER_EXISTS", { rawDetail: raw, ocsStatuscode: 103 });
      case 997:
        throw new NextcloudError("NC_AUTH_FAILED", { rawDetail: raw, ocsStatuscode: 997 });
      default:
        throw new NextcloudError("NC_ERROR", { rawDetail: raw, ocsStatuscode: statuscode || undefined });
    }
  },

  /** PUT key/value (quota, email, displayname, password...). */
  async editUser(userid: string, key: "quota" | "email" | "displayname" | "password", value: string): Promise<void> {
    const config = getNextcloudConfig();
    ensureConfigured(config);
    const body = new URLSearchParams({ key, value });
    const result = await rawCall<unknown>(
      ocsUrl(config, `/users/${encodeURIComponent(userid)}`),
      {
        method: "PUT",
        headers: { ...baseHeaders(config), "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      config,
      "PUT",
    );
    if (result.httpStatus === 404 || result.meta?.statuscode === 998) {
      throw new NextcloudError("NC_NOT_FOUND", {
        rawDetail: `Nextcloud PUT ${key} on missing user ${userid}.`,
      });
    }
    if (result.meta && result.meta.status !== "ok") {
      const statuscode = result.meta.statuscode ?? 0;
      const raw = `Nextcloud PUT ${key} failed: ${statuscode} ${result.meta.message}`;
      if (key === "password" && statuscode === 102) {
        throw new NextcloudError("NC_INVALID_PASSWORD", { rawDetail: raw, ocsStatuscode: 102 });
      }
      throw new NextcloudError("NC_ERROR", { rawDetail: raw, ocsStatuscode: statuscode || undefined });
    }
    if (result.parseError) {
      throw new NextcloudError("NC_ERROR", { rawDetail: `Nextcloud PUT ${key} returned an unparseable body.` });
    }
  },

  async setQuota(userid: string, humanQuota: string): Promise<void> {
    await this.editUser(userid, "quota", humanQuota);
  },

  async setUserEnabled(userid: string, enabled: boolean): Promise<void> {
    const config = getNextcloudConfig();
    ensureConfigured(config);
    const action = enabled ? "enable" : "disable";
    const result = await rawCall<unknown>(
      ocsUrl(config, `/users/${encodeURIComponent(userid)}/${action}`),
      {
        method: "PUT",
        headers: { ...baseHeaders(config), "Content-Type": "application/x-www-form-urlencoded" },
      },
      config,
      "PUT",
    );
    if (result.httpStatus === 404 || result.meta?.statuscode === 998) {
      throw new NextcloudError("NC_NOT_FOUND", {
        rawDetail: `Nextcloud ${action} on missing user ${userid}.`,
      });
    }
    if (result.meta && result.meta.status !== "ok") {
      throw new NextcloudError("NC_ERROR", {
        rawDetail: `Nextcloud ${action} failed: ${result.meta.statuscode} ${result.meta.message}`,
        ocsStatuscode: result.meta.statuscode || undefined,
      });
    }
    if (result.parseError) {
      throw new NextcloudError("NC_ERROR", { rawDetail: `Nextcloud ${action} returned an unparseable body.` });
    }
  },
};
