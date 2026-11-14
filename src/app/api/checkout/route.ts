// POST /api/checkout — create an order from the cart (server-side pricing).
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { orderService } from "@/lib/commerce/orders";
import { handleRouteError, readJson } from "@/lib/api/http";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await readJson<{ invoiceTitle?: string; invoiceCompany?: string }>(request);
    const order = await orderService.checkout(user, {
      invoiceTitle: String(body?.invoiceTitle ?? ""),
      invoiceCompany: body?.invoiceCompany ? String(body.invoiceCompany) : undefined,
    });
    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "checkout");
  }
}
