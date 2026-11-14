// GET /api/admin/orders — all orders with customer info.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { toOrderDTO } from "@/lib/commerce/orders";
import { handleRouteError } from "@/lib/api/http";
import type { AdminOrderDTO } from "@/lib/api/types";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("orders.view", request);
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const orders = await db.order.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    const result: AdminOrderDTO[] = orders.map((o) => ({
      ...toOrderDTO(o),
      customer: o.user,
    }));
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "admin/orders");
  }
}
