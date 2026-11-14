// GET /api/invoices — the customer's invoices.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { orderService } from "@/lib/commerce/orders";
import { handleRouteError } from "@/lib/api/http";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await orderService.listInvoices(user.id));
  } catch (error) {
    return handleRouteError(error, "invoices");
  }
}
