// GET /api/admin/invoices — all invoices.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { toInvoiceDTO } from "@/lib/commerce/orders";
import { handleRouteError } from "@/lib/api/http";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("orders.view", request);
    const invoices = await db.invoice.findMany({
      orderBy: { issuedAt: "desc" },
      // Bounded operational window (audit §3.3).
      take: 500,
      include: { order: true },
    });
    return NextResponse.json(invoices.map(toInvoiceDTO));
  } catch (error) {
    return handleRouteError(error, "admin/invoices");
  }
}
