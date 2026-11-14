// GET /api/admin/users — panel users incl. admins/staff (admin only).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { handleRouteError } from "@/lib/api/http";
import type { AdminCustomerDTO } from "@/lib/api/types";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("settings.manage", request);
    const users = await db.panelUser.findMany({ orderBy: { createdAt: "desc" } });
    const result: AdminCustomerDTO[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      mobile: u.mobile,
      company: u.company,
      role: (u.role as AdminCustomerDTO["role"]) ?? "customer",
      status: (u.status as AdminCustomerDTO["status"]) ?? "active",
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      orderCount: 0,
      paidTotalToman: 0,
      hasDrive: false,
      activeSubscription: null,
    }));
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "admin/users");
  }
}
