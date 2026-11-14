// GET /api/services — the customer's services.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { orderService } from "@/lib/commerce/orders";
import { handleRouteError } from "@/lib/api/http";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await orderService.listServices(user.id));
  } catch (error) {
    return handleRouteError(error, "services");
  }
}
