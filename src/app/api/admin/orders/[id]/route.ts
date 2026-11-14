// GET /api/admin/orders/[id] — order detail with customer info.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { toOrderDTO } from "@/lib/commerce/orders";
import { apiError, handleRouteError } from "@/lib/api/http";
import type { AdminOrderDTO } from "@/lib/api/types";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminAccess("orders.view", request);
    const { id } = await context.params;
    const order = await db.order.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    if (!order) return apiError(404, "ORDER_NOT_FOUND", "سفارش یافت نشد.");
    const result: AdminOrderDTO = { ...toOrderDTO(order), customer: order.user };
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "admin/orders/[id]");
  }
}
