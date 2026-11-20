// Role-based access control for the AbrIT platform.
//
// Roles (aligned with the Orchard portal's separation between CMS
// administrators, staff and customers):
//   admin   — full access to the AbrIT Admin area and every business module.
//   staff   — operational access (tickets, content, orders, drive, reports)
//             but NOT identity/settings administration.
//   customer— customer portal only; every /api/admin/* route is closed.
//
// Ordinary customers never receive Orchard-admin-equivalent permissions.
//
// SERVICE-TO-SERVICE ACCESS: the real Orchard Core administration (the CMS
// that owns /admin) reads the canonical business records (customers, orders,
// payments, subscriptions, Drive accounts) through these same /api/admin/*
// routes using a shared secret (ABRIT_SERVICE_TOKEN) — the documented
// server-to-server contract between the two applications. The token is
// compared in constant time and is only honored when configured, and it is
// ENFORCED (not just documented) to grant exactly the permissions the CMS
// pages need — read access to the business records plus pricing-catalog
// management. It is deliberately NOT an administrator: identity/settings
// administration, user role changes and maintenance operations stay
// human-only (full-remediation audit §2.3).

import { timingSafeEqual } from "node:crypto";
import type { PanelUser } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { HttpError } from "@/lib/api/http";

export type Role = "admin" | "staff" | "customer";

export const ROLE_LABELS_FA: Record<Role, string> = {
  admin: "مدیر سیستم",
  staff: "کارشناس پشتیبانی",
  customer: "مشتری",
};

/** The synthetic principal used for service-to-service (Orchard) access. */
export const SERVICE_PRINCIPAL: PanelUser = Object.freeze({
  id: "orchard-service",
  email: "orchard@abrit.internal",
  name: "Orchard Core (service)",
  mobile: null,
  company: null,
  passwordHash: "",
  role: "admin",
  status: "active",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastLoginAt: null,
} as PanelUser);

/**
 * EXACT permission set granted to the service token (Orchard CMS). This is
 * the enforced equivalent of the documented "read access plus the explicitly
 * listed actions" contract: everything the AbrIT admin pages actually call
 * (dashboard, customers, orders/payments, subscriptions, drive, tickets,
 * reports, pricing catalog) — and nothing else. Destructive/administrative
 * areas (users, settings, maintenance/cleanup, audit, content, media…) stay
 * reserved for signed-in human administrators.
 */
export const SERVICE_PRINCIPAL_PERMISSIONS: ReadonlySet<string> = new Set([
  "dashboard.view",
  "customers.view",
  "orders.view",
  "subscriptions.view",
  "drive.manage",
  "tickets.manage",
  "reports.view",
  "pricing.manage",
]);

/** Constant-time service-token check. Returns true only when configured AND matching. */
export function isServiceRequest(request: Request): boolean {
  const expected = (process.env.ABRIT_SERVICE_TOKEN ?? "").trim();
  if (expected.length < 16) return false; // refuse short/unset secrets
  const header =
    request.headers.get("x-abrit-service-token") ??
    (request.headers.get("authorization")?.startsWith("Bearer ")
      ? (request.headers.get("authorization") as string).slice(7).trim()
      : "");
  if (!header) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Permission catalogue shown in the admin Roles & Permissions screen. */
export const PERMISSIONS: Array<{ key: string; labelFa: string; groupFa: string }> = [
  { key: "dashboard.view", labelFa: "مشاهده داشبورد عملیاتی", groupFa: "عمومی" },
  { key: "customers.view", labelFa: "مشاهده مشتریان", groupFa: "عملیات" },
  { key: "orders.view", labelFa: "مشاهده سفارش‌ها و پرداخت‌ها", groupFa: "عملیات" },
  { key: "subscriptions.view", labelFa: "مشاهده اشتراک‌ها", groupFa: "عملیات" },
  { key: "drive.manage", labelFa: "مدیریت حساب‌های Drive", groupFa: "عملیات" },
  { key: "tickets.manage", labelFa: "پاسخ به تیکت‌ها", groupFa: "پشتیبانی" },
  { key: "content.manage", labelFa: "مدیریت محتوا و رسانه", groupFa: "محتوا" },
  { key: "media.manage", labelFa: "مدیریت کتابخانه رسانه", groupFa: "محتوا" },
  { key: "reports.view", labelFa: "مشاهده گزارش‌ها", groupFa: "گزارش" },
  { key: "audit.view", labelFa: "مشاهده لاگ حسابرسی", groupFa: "گزارش" },
  { key: "queries.view", labelFa: "پرس‌وجوهای محتوا", groupFa: "گزارش" },
  { key: "recipes.manage", labelFa: "دستورالعمل‌های محتوا", groupFa: "گزارش" },
  { key: "pricing.manage", labelFa: "مدیریت کاتالوگ قیمت", groupFa: "مدیریت" },
  { key: "users.manage", labelFa: "مدیریت کاربران و نقش‌ها", groupFa: "مدیریت" },
  { key: "settings.manage", labelFa: "تنظیمات سیستم", groupFa: "مدیریت" },
];

const STAFF_PERMISSIONS = new Set([
  "dashboard.view",
  "customers.view",
  "orders.view",
  "subscriptions.view",
  "drive.manage",
  "tickets.manage",
  "content.manage",
  "media.manage",
  "reports.view",
  "audit.view",
  "queries.view",
  "recipes.manage",
]);

export function hasPermission(role: string, permission: string): boolean {
  if (role === "admin") return true;
  if (role === "staff") return STAFF_PERMISSIONS.has(permission);
  return false;
}

export function isAdminAreaUser(user: PanelUser): boolean {
  return (user.role === "admin" || user.role === "staff") && user.status === "active";
}

/**
 * Resolves the caller for an admin-area request: either a signed-in,
 * permission-checked panel user, or the service principal when the request
 * carries the valid ABRIT_SERVICE_TOKEN (Orchard server-to-server) — in
 * which case the permission is checked against the fixed service allowlist
 * (SERVICE_PRINCIPAL_PERMISSIONS), so the token can never act as a full
 * administrator.
 */
export async function requireAdminAccess(permission: string, request: Request): Promise<PanelUser> {
  if (isServiceRequest(request)) {
    if (!SERVICE_PRINCIPAL_PERMISSIONS.has(permission)) {
      throw new HttpError(403, "FORBIDDEN", "دسترسی سرویس به این بخش مجاز نیست.");
    }
    return SERVICE_PRINCIPAL;
  }
  const user = await requireUser();
  if (!isAdminAreaUser(user) || !hasPermission(user.role, permission)) {
    throw new HttpError(403, "FORBIDDEN", "شما به این بخش دسترسی ندارید.");
  }
  return user;
}

/** Resolves the signed-in, active user or throws 401. */
export async function requireUser(): Promise<PanelUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new HttpError(401, "NOT_AUTHENTICATED", "برای این عملیات باید وارد پنل شوید.");
  }
  if (user.status === "disabled") {
    throw new HttpError(403, "ACCOUNT_DISABLED", "حساب کاربری شما غیرفعال است؛ با پشتیبانی تماس بگیرید.");
  }
  return user;
}

/** Requires one of the given roles (admin area guard). */
export async function requireRole(...roles: string[]): Promise<PanelUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new HttpError(403, "FORBIDDEN", "شما به این بخش دسترسی ندارید.");
  }
  return user;
}

/** Requires a specific permission (admin area guard, staff-aware). */
export async function requirePermission(permission: string): Promise<PanelUser> {
  const user = await requireUser();
  if (!isAdminAreaUser(user) || !hasPermission(user.role, permission)) {
    throw new HttpError(403, "FORBIDDEN", "شما به این بخش دسترسی ندارید.");
  }
  return user;
}
