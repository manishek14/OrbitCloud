// AbrIT Drive — Nextcloud OCS emulator (simulation mode).
//
// Speaks the same User Provisioning API as a real Nextcloud instance
// (https://docs.nextcloud.com/server/stable/admin_manual/configuration_user/user_provisioning_api.html)
// so the portal integration can be developed, demonstrated and tested end-to-end
// without production credentials for https://drive.abrit.cloud.
//
// Port: 3031 (fixed; referenced by the gateway as ?XTransformPort=3031).
// Admin credentials come from MOCK_ADMIN_USER / MOCK_ADMIN_PASSWORD and must
// match the portal's NEXTCLOUD_ADMIN_USER / NEXTCLOUD_ADMIN_APP_PASSWORD in
// simulation mode.
//
// Endpoints:
//   GET    /status.php                       Nextcloud-style status
//   OCS (admin Basic auth + "OCS-APIRequest: true" required):
//     GET    /ocs/v{1,2}.php/cloud/users?search=
//     GET    /ocs/v{1,2}.php/cloud/users/<id>
//     POST   /ocs/v{1,2}.php/cloud/users              {userid,password,email?}
//     PUT    /ocs/v{1,2}.php/cloud/users/<id>         {key,value}
//     PUT    /ocs/v{1,2}.php/cloud/users/<id>/enable | /disable
//     DELETE /ocs/v{1,2}.php/cloud/users/<id>
//   Web UI (any other path): login, files overview with quota bar,
//     demo upload (+5 MB), logout.

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = 3031;
const DATA_DIR = join(import.meta.dir, "data");
const DB_FILE = join(DATA_DIR, "db.json");
const UNLIMITED = -3; // Nextcloud SPACE_UNLIMITED
const PSEUDO_DISK = 1024 ** 4; // 1 TB "free disk" reported for unlimited users

const ADMIN_USER = (process.env.MOCK_ADMIN_USER ?? "abrit-portal-admin").trim();
const ADMIN_PASSWORD = (process.env.MOCK_ADMIN_PASSWORD ?? "abrit-simulation-app-password").trim();

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface MockUser {
  userid: string;
  email: string | null;
  displayname: string | null;
  passwordHash: string;
  enabled: boolean;
  quotaBytes: number; // byte limit or UNLIMITED (-3)
  usedBytes: number;
  createdAt: number;
  lastLoginAt: number | null;
}

interface Db {
  users: Record<string, MockUser>;
  webSessions: Record<string, string>; // token -> userid
}

function loadDb(): Db {
  try {
    if (existsSync(DB_FILE)) {
      const parsed = JSON.parse(readFileSync(DB_FILE, "utf-8")) as Db;
      return { users: parsed.users ?? {}, webSessions: parsed.webSessions ?? {} };
    }
  } catch {
    /* fall through to a fresh db */
  }
  return { users: {}, webSessions: {} };
}

const db: Db = loadDb();

function saveDb(): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DB_FILE, JSON.stringify(db));
  } catch (error) {
    console.error("[nextcloud-mock] failed to persist db:", error);
  }
}

// ---------------------------------------------------------------------------
// Passwords (same scrypt scheme as the portal, independent implementation)
// ---------------------------------------------------------------------------

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// OCS response helpers
// ---------------------------------------------------------------------------

function ocsOk(data: unknown, status = 200): Response {
  return Response.json(
    { ocs: { meta: { status: "ok", statuscode: 100, message: "OK" }, data } },
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

function ocsFail(statuscode: number, message: string, httpStatus = 200): Response {
  return Response.json(
    { ocs: { meta: { status: "failure", statuscode, message }, data: [] } },
    { status: httpStatus, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

// ---------------------------------------------------------------------------
// Validation (mirrors the real Nextcloud rules the portal relies on)
// ---------------------------------------------------------------------------

const USERID_RE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/; // kept for reference; POST allows mixed case like real Nextcloud

function validPassword(password: string): boolean {
  return typeof password === "string" && password.length >= 8 && password.length <= 128 &&
    /[A-Za-zآ-ی]/.test(password) && /[0-9]/.test(password);
}

/** "none" | "no limit" | "10240" | "100 MB" | "10 GB" ... -> bytes | UNLIMITED */
function parseQuotaValue(raw: string): number | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (/^(none|no limit)$/i.test(value)) return UNLIMITED;
  if (/^\d+$/.test(value)) {
    const bytes = Number(value);
    return bytes > 0 ? bytes : null;
  }
  const match = value.match(/^([\d]+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)$/i);
  if (!match) return null;
  const factors: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  const bytes = Math.round(Number(match[1]) * factors[match[2].toUpperCase()]);
  return bytes > 0 ? bytes : null;
}

function quotaObject(user: MockUser): { free: number; used: number; total: number; relative: number; quota: number } {
  const unlimited = user.quotaBytes === UNLIMITED;
  const total = unlimited ? PSEUDO_DISK : user.quotaBytes;
  const used = Math.max(0, user.usedBytes);
  const free = unlimited ? Math.max(0, PSEUDO_DISK - used) : Math.max(0, total - used);
  const relative = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
  return { free, used, total, relative, quota: user.quotaBytes };
}

function userData(user: MockUser): Record<string, unknown> {
  return {
    id: user.userid,
    enabled: user.enabled,
    email: user.email ?? "",
    displayname: user.displayname ?? user.userid,
    quota: quotaObject(user),
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function basicAdminOk(request: Request): boolean {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    const user = decoded.slice(0, separator);
    const pass = decoded.slice(separator + 1);
    return user === ADMIN_USER && pass === ADMIN_PASSWORD;
  } catch {
    return false;
  }
}

async function readBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const parsed = (await request.json()) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed ?? {})) out[k] = v === null || v === undefined ? "" : String(v);
      return out;
    } catch {
      return {};
    }
  }
  try {
    const form = await request.formData();
    const out: Record<string, string> = {};
    for (const [k, v] of form.entries()) out[k] = String(v);
    return out;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// OCS router
// ---------------------------------------------------------------------------

async function handleOcs(request: Request, url: URL): Promise<Response> {
  if (request.headers.get("OCS-APIRequest")?.toLowerCase() !== "true") {
    return ocsFail(400, "OCS-APIRequest header missing", 400);
  }
  if (!basicAdminOk(request)) {
    return Response.json(
      { ocs: { meta: { status: "failure", statuscode: 997, message: "Unauthorised" }, data: [] } },
      { status: 401, headers: { "Content-Type": "application/json; charset=utf-8", "Www-Authenticate": 'Basic realm="Nextcloud"' } },
    );
  }

  // Strip /ocs/v{1,2}.php/cloud prefix.
  const cloudPath = url.pathname.replace(/^\/ocs\/v[12]\.php\/cloud/, "");
  const segments = cloudPath.split("/").filter(Boolean);
  const method = request.method.toUpperCase();

  // GET /users?search=...
  if (method === "GET" && segments.length === 1 && segments[0] === "users") {
    const search = (url.searchParams.get("search") ?? "").toLowerCase();
    const ids = Object.keys(db.users)
      .filter((id) => id.includes(search))
      .sort()
      .slice(0, 30);
    return ocsOk(ids);
  }

  // POST /users — create
  if (method === "POST" && segments.length === 1 && segments[0] === "users") {
    const body = await readBody(request);
    // Validate the raw value (mixed case is allowed, like real Nextcloud);
    // accounts are stored under a lowercase key for case-insensitive lookups.
    const rawUserid = String(body.userid ?? "").trim();
    const password = String(body.password ?? "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,30}[A-Za-z0-9]$/.test(rawUserid)) return ocsFail(101, "Invalid username");
    if (!validPassword(password)) return ocsFail(102, "Invalid password (min 8 chars, letters and digits)");
    const userid = rawUserid.toLowerCase();
    if (db.users[userid]) return ocsFail(103, "User already exists");
    const email = String(body.email ?? "").trim() || null;
    db.users[userid] = {
      userid: rawUserid,
      email,
      displayname: rawUserid,
      passwordHash: hashPassword(password),
      enabled: true,
      quotaBytes: UNLIMITED, // Nextcloud default until an explicit quota is set
      usedBytes: 0,
      createdAt: Date.now(),
      lastLoginAt: null,
    };
    saveDb();
    console.log(`[nextcloud-mock] user created: ${userid}`);
    return ocsOk({ id: userid });
  }

  // Everything else is /users/<userid>[/<action>]
  if (segments.length >= 2 && segments[0] === "users") {
    const userid = decodeURIComponent(segments[1]).toLowerCase();
    const user = db.users[userid];
    const action = segments[2] ?? "";

    if (method === "GET" && !action) {
      if (!user) return ocsFail(998, "The requested user could not be found", 404);
      return ocsOk(userData(user));
    }

    if (method === "PUT" && !action) {
      if (!user) return ocsFail(998, "The requested user could not be found", 404);
      const body = await readBody(request);
      const key = String(body.key ?? "");
      const value = String(body.value ?? "");
      switch (key) {
        case "quota": {
          const bytes = parseQuotaValue(value);
          if (bytes === null) return ocsFail(102, `Invalid quota value: ${value}`);
          user.quotaBytes = bytes;
          break;
        }
        case "email":
          user.email = value.trim() || null;
          break;
        case "displayname":
          user.displayname = value.trim() || user.userid;
          break;
        case "password":
          if (!validPassword(value)) return ocsFail(102, "Invalid password (min 8 chars, letters and digits)");
          user.passwordHash = hashPassword(value);
          break;
        default:
          return ocsFail(102, `Unknown edit key: ${key}`);
      }
      saveDb();
      return ocsOk(true);
    }

    if (method === "PUT" && (action === "enable" || action === "disable")) {
      if (!user) return ocsFail(998, "The requested user could not be found", 404);
      user.enabled = action === "enable";
      saveDb();
      console.log(`[nextcloud-mock] user ${userid} ${action}d`);
      return ocsOk(true);
    }

    if (method === "DELETE" && !action) {
      if (!user) return ocsFail(998, "The requested user could not be found", 404);
      delete db.users[userid];
      for (const [token, owner] of Object.entries(db.webSessions)) {
        if (owner === userid) delete db.webSessions[token];
      }
      saveDb();
      return ocsOk(true);
    }
  }

  return ocsFail(998, "Invalid query, please check the syntax. API specifications are here: http://www.freedesktop.org/wiki/Specifications/openCollaborationServices.", 404);
}

// ---------------------------------------------------------------------------
// Web UI (login / files) — any non-API path
// ---------------------------------------------------------------------------

const FA_DIGITS: Record<string, string> = { "0": "۰", "1": "۱", "2": "۲", "3": "۳", "4": "۴", "5": "۵", "6": "۶", "7": "۷", "8": "۸", "9": "۹" };
const fa = (s: string | number): string => String(s).replace(/\d/g, (d) => FA_DIGITS[d] ?? d);

function faBytes(bytes: number): string {
  const abs = Math.abs(bytes);
  if (abs >= 1024 ** 3) return fa((bytes / 1024 ** 3).toFixed(1)) + " گیگابایت";
  if (abs >= 1024 ** 2) return fa((bytes / 1024 ** 2).toFixed(1)) + " مگابایت";
  if (abs >= 1024) return fa((bytes / 1024).toFixed(1)) + " کیلوبایت";
  return fa(Math.round(bytes)) + " بایت";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Vazirmatn, "Segoe UI", Tahoma, sans-serif; background: #f8fafc; color: #0f172a; }
  header { background: #0f172a; color: #f8fafc; padding: 14px 20px; display: flex; align-items: center; gap: 12px; }
  header .logo { width: 34px; height: 34px; border-radius: 8px; background: #10b981; display: grid; place-items: center; font-weight: 800; color: #052e22; }
  header .brand { font-weight: 700; }
  header .tag { font-size: 12px; background: #134e38; color: #6ee7b7; border-radius: 999px; padding: 3px 10px; }
  main { max-width: 720px; margin: 40px auto; padding: 0 20px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; box-shadow: 0 8px 24px rgb(15 23 42 / 6%); }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p.muted { color: #64748b; font-size: 13px; margin: 4px 0 16px; }
  label { display: block; font-size: 13px; margin: 12px 0 4px; color: #334155; }
  input[type=text], input[type=password] { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 10px; font: inherit; background: #fff; }
  input:focus { outline: 2px solid #10b981; border-color: #10b981; }
  button { margin-top: 16px; width: 100%; padding: 11px; border: 0; border-radius: 10px; background: #10b981; color: #052e22; font: inherit; font-weight: 700; cursor: pointer; }
  button.secondary { background: #e2e8f0; color: #0f172a; }
  button:hover { filter: brightness(0.97); }
  .alert { border-radius: 10px; padding: 10px 14px; font-size: 13px; margin-bottom: 14px; }
  .alert.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .alert.info { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .quota-bar { height: 12px; background: #e2e8f0; border-radius: 999px; overflow: hidden; margin: 10px 0 6px; }
  .quota-bar > div { height: 100%; background: #10b981; border-radius: 999px; }
  .quota-bar > div.warn { background: #f59e0b; }
  .quota-bar > div.full { background: #ef4444; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 14px; margin: 16px 0; }
  dt { color: #64748b; } dd { margin: 0; font-weight: 600; }
  footer { text-align: center; color: #94a3b8; font-size: 12px; padding: 24px; }
</style>
</head>
<body>
<header>
  <span class="logo" aria-hidden="true">A</span>
  <span class="brand">AbrIT Drive</span>
  <span class="tag">شبیه‌ساز Nextcloud — فقط برای تست اتصال پنل</span>
</header>
<main>${body}</main>
<footer>این سرویس، شبیه‌ساز API مدیریت کاربران Nextcloud (OCS) است و داده‌های واقعی ندارد.</footer>
</body>
</html>`;
}

function loginPage(error?: string, info?: string): string {
  const alerts =
    (error ? `<div class="alert error" role="alert">${escapeHtml(error)}</div>` : "") +
    (info ? `<div class="alert info" role="status">${escapeHtml(info)}</div>` : "");
  return pageShell(
    "ورود — AbrIT Drive",
    `<div class="card">
  <h1>ورود به فضای ابری</h1>
  <p class="muted">با نام کاربری و رمز عبوری که از پنل AbrIT تعیین کردید وارد شوید.</p>
  ${alerts}
  <form method="post" action="/login?XTransformPort=3031">
    <label for="user">نام کاربری</label>
    <input id="user" name="user" type="text" autocomplete="username" required>
    <label for="password">رمز عبور</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">ورود</button>
  </form>
</div>`,
  );
}

function filesPage(user: MockUser, flash?: string): string {
  const q = quotaObject(user);
  const unlimited = user.quotaBytes === UNLIMITED;
  const total = unlimited ? PSEUDO_DISK : user.quotaBytes;
  const percent = total > 0 ? Math.min(100, Math.round((q.used / total) * 100)) : 0;
  const tone = percent >= 90 ? "full" : percent >= 75 ? "warn" : "";
  const quotaText = unlimited ? "بدون محدودیت" : faBytes(user.quotaBytes);
  const alerts = flash ? `<div class="alert info" role="status">${escapeHtml(flash)}</div>` : "";
  return pageShell(
    "فایل‌های من — AbrIT Drive",
    `<div class="card">
  <h1>سلام ${escapeHtml(user.displayname ?? user.userid)}</h1>
  <p class="muted">فضای ابری شما در سرویس AbrIT Drive (شبیه‌سازی).</p>
  ${alerts}
  <div class="quota-bar" role="img" aria-label="${fa(percent)} درصد پر شده"><div class="${tone}" style="width:${percent}%"></div></div>
  <p class="muted">${faBytes(q.used)} از ${quotaText} استفاده شده — ${fa(percent)}٪</p>
  <dl>
    <dt>نام کاربری</dt><dd>${escapeHtml(user.userid)}</dd>
    <dt>ایمیل</dt><dd>${escapeHtml(user.email ?? "—")}</dd>
    <dt>وضعیت حساب</dt><dd>${user.enabled ? "فعال" : "غیرفعال"}</dd>
    <dt>سهمیه</dt><dd>${quotaText}</dd>
  </dl>
  <form method="post" action="/demo-upload?XTransformPort=3031">
    <button type="submit">آپلود فایل آزمایشی (۵ مگابایت)</button>
  </form>
  <form method="post" action="/logout?XTransformPort=3031">
    <button type="submit" class="secondary">خروج از حساب</button>
  </form>
</div>`,
  );
}

function sessionUser(request: Request): MockUser | null {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)abrit_drive_sim=([\w-]+)/);
  if (!match) return null;
  const userid = db.webSessions[match[1]];
  if (!userid) return null;
  return db.users[userid] ?? null;
}

async function handleWeb(request: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "GET") {
    const user = sessionUser(request);
    if (user && user.enabled) {
      return new Response(filesPage(user), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (user && !user.enabled) {
      return new Response(loginPage("حساب شما غیرفعال شده است؛ از پنل کاربری AbrIT دوباره فعالش کنید."), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    const info = url.searchParams.get("registered") ? "حساب شما ایجاد شد؛ حالا وارد شوید." : undefined;
    return new Response(loginPage(undefined, info), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (request.method === "POST") {
    const body = await readBody(request);

    if (path === "/login") {
      const userid = String(body.user ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const user = db.users[userid];
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return new Response(loginPage("نام کاربری یا رمز عبور اشتباه است."), {
          status: 401,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (!user.enabled) {
        return new Response(loginPage("حساب شما غیرفعال شده است؛ از پنل کاربری AbrIT دوباره فعالش کنید."), {
          status: 403,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      const token = randomBytes(24).toString("base64url");
      db.webSessions[token] = userid;
      user.lastLoginAt = Date.now();
      saveDb();
      console.log(`[nextcloud-mock] web login: ${userid}`);
      return new Response(null, {
        status: 303,
        headers: {
          Location: `/?XTransformPort=3031`,
          "Set-Cookie": `abrit_drive_sim=${token}; Path=/; HttpOnly; SameSite=Lax`,
        },
      });
    }

    if (path === "/demo-upload") {
      const user = sessionUser(request);
      if (!user || !user.enabled) return new Response(null, { status: 303, headers: { Location: `/?XTransformPort=3031` } });
      const CHUNK = 5 * 1024 * 1024;
      if (user.quotaBytes !== UNLIMITED && user.usedBytes + CHUNK > user.quotaBytes) {
        return new Response(filesPage(user, "فضای کافی برای آپلود ندارید؛ سهمیه خود را از پنل افزایش دهید."), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      user.usedBytes += CHUNK;
      saveDb();
      return new Response(filesPage(user, "فایل آزمایشی ۵ مگابایتی آپلود شد."), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (path === "/logout") {
      const cookie = request.headers.get("Cookie") ?? "";
      const match = cookie.match(/(?:^|;\s*)abrit_drive_sim=([\w-]+)/);
      if (match) {
        delete db.webSessions[match[1]];
        saveDb();
      }
      return new Response(null, { status: 303, headers: { Location: `/?XTransformPort=3031` } });
    }
  }

  return new Response("Not Found", { status: 404 });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/status.php") {
        return Response.json({
          installed: true,
          maintenance: false,
          needsDbUpgrade: false,
          version: "35.0.1.1",
          versionstring: "35.0.1",
          edition: "",
          productname: "Nextcloud (AbrIT Simulation)",
          extendedSupport: false,
        });
      }
      if (url.pathname.startsWith("/ocs/")) return await handleOcs(request, url);
      return await handleWeb(request, url);
    } catch (error) {
      console.error("[nextcloud-mock] unhandled error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
});

console.log(`[nextcloud-mock] listening on http://127.0.0.1:${PORT} (admin: ${ADMIN_USER})`);
