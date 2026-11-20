// GET + PATCH /api/admin/customers/[id] — customer detail & update.
//
// GET is the endpoint the Orchard admin "customer details" page reads through
// CommerceApiClient (full-remediation audit §3.1: it previously only had
// PATCH, so every Orchard customer-detail request 404'd). Role/status changes
// remain admin-only; staff may only edit names; the service principal is
// read-only here by design.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { adminCustomerService } from "@/lib/admin/customers";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";
import { audit } from "@/lib/audit";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminAccess("customers.view", request);
    const { id } = await context.params;
    if (!id || id.length > 64) {
      return apiError(400, "VALIDATION", "شناسه مشتری معتبر نیست.");
    }
    const customer = await adminCustomerService.get(id);
    if (!customer) return apiError(404, "NOT_FOUND", "کاربر یافت نشد.");
    return NextResponse.json(customer);
  } catch (error) {
    return handleRouteError(error, "admin/customers/[id]");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdminAccess("customers.view", request);
    const { id } = await context.params;
    const body = await readJson<{ role?: string; status?: string; name?: string }>(request);
    const target = await db.panelUser.findUnique({ where: { id } });
    if (!target) return apiError(404, "NOT_FOUND", "کاربر یافت نشد.");

    const data: Record<string, unknown> = {};
    if (body?.name !== undefined) data.name = String(body.name).trim().slice(0, 80) || null;

    // Role/status changes require the admin role (staff cannot escalate).
    if (body?.role !== undefined || body?.status !== undefined) {
      await requireAdminAccess("settings.manage", request);
      if (body.role && ["admin", "staff", "customer"].includes(body.role)) data.role = body.role;
      if (body.status && ["active", "disabled"].includes(body.status)) data.status = body.status;
      if (target.id === actor.id && (data.status === "disabled" || (data.role && data.role !== "admin"))) {
        return apiError(409, "SELF_LOCKOUT", "نمی‌توانید سطح دسترسی یا وضعیت حساب خودتان را کاهش دهید.");
      }
    }

    if (Object.keys(data).length === 0) {
      return apiError(400, "VALIDATION", "تغییری برای اعمال ارسال نشد.");
    }
    await db.panelUser.update({ where: { id }, data });
    await audit({ actor, action: "user.updated", entityType: "user", entityId: id, meta: data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "admin/customers/[id]");
  }
}
