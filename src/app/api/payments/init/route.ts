// POST /api/payments/init — create a pending transaction with a REAL payment
// provider (ZarinPal Sandbox / Zibal Sandbox; Mellat always rejected) and
// return the provider payment-page URL for a full-page browser redirect.
//
// External gateways require the explicit public HTTPS origin of this Portal.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { orderService } from "@/lib/commerce/orders";
import { handleRouteError, readJson } from "@/lib/api/http";
import { publicPaymentOrigin } from "@/lib/payments/callback-origin";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await readJson<{ orderId?: string; gateway?: string }>(request);
    const gateway = String(body?.gateway ?? "zarinpal");
    const result = await orderService.initiatePayment(
      user,
      String(body?.orderId ?? ""),
      gateway,
      gateway.trim().toLowerCase() === "mock" ? "" : publicPaymentOrigin(),
    );
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "payments/init");
  }
}
