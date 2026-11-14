// GET /api/admin/customers — customer directory with real aggregates.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { readCommercialCatalog } from "@/lib/commerce/catalog";
import { handleRouteError } from "@/lib/api/http";
import type { AdminCustomerDTO } from "@/lib/api/types";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("customers.view", request);
    const query = (new URL(request.url).searchParams.get("query") ?? "").trim().toLowerCase();

    const users = await db.panelUser.findMany({
      where: query
        ? {
            OR: [
              { email: { contains: query } },
              { name: { contains: query } },
              { mobile: { contains: query } },
              { company: { contains: query } },
            ],
          }
        : undefined,
      orderBy: { createdAt: "desc" },
    });

    const catalog = await readCommercialCatalog();
    const result: AdminCustomerDTO[] = [];
    for (const u of users) {
      const [orderCount, paidAgg, hasDrive, activeSub] = await Promise.all([
        db.order.count({ where: { userId: u.id } }),
        db.transaction.aggregate({ where: { userId: u.id, status: "succeeded" }, _sum: { amountToman: true } }),
        db.driveAccount.findUnique({ where: { panelUserId: u.id }, select: { id: true } }),
        db.subscription.findFirst({ where: { userId: u.id, status: "active", expiresAt: { gt: new Date() } } }),
      ]);
      result.push({
        id: u.id,
        email: u.email,
        name: u.name,
        mobile: u.mobile,
        company: u.company,
        role: (u.role as AdminCustomerDTO["role"]) ?? "customer",
        status: (u.status as AdminCustomerDTO["status"]) ?? "active",
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        orderCount,
        paidTotalToman: paidAgg._sum.amountToman ?? 0,
        hasDrive: Boolean(hasDrive),
        activeSubscription: activeSub ? (catalog.packages.find((p) => p.code === activeSub.packageCode)?.nameFa ?? activeSub.packageCode) : null,
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "admin/customers");
  }
}
