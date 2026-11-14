// GET /api/transactions — the customer's payment transactions.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { orderService } from "@/lib/commerce/orders";
import { handleRouteError } from "@/lib/api/http";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await orderService.listTransactions(user.id));
  } catch (error) {
    return handleRouteError(error, "transactions");
  }
}
