// GET /api/orders — the signed-in customer's orders.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { orderService } from "@/lib/commerce/orders";
import { handleRouteError } from "@/lib/api/http";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await orderService.listOrders(user.id));
  } catch (error) {
    return handleRouteError(error, "orders");
  }
}
