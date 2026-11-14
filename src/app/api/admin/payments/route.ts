// GET /api/admin/payments — all transactions (read-only; status changes only
// through the gateway callback).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { toTransactionDTO } from "@/lib/commerce/orders";
import { handleRouteError } from "@/lib/api/http";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("orders.view", request);
    const txs = await db.transaction.findMany({
      orderBy: { createdAt: "desc" },
      include: { order: true },
    });
    return NextResponse.json(txs.map(toTransactionDTO));
  } catch (error) {
    return handleRouteError(error, "admin/payments");
  }
}
