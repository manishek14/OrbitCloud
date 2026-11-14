// POST /api/orders/[id]/cancel — cancel a pending order.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { orderService } from "@/lib/commerce/orders";
import { handleRouteError } from "@/lib/api/http";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    await orderService.cancelOrder(user, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "orders/[id]/cancel");
  }
}
