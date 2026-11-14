// GET /api/payments/callback/[gateway] — the provider's browser-redirect
// callback (ZarinPal Sandbox / Zibal Sandbox).
//
// The provider query parameters alone are NEVER trusted: after extracting the
// provider reference (ZarinPal Authority / Zibal trackId) the transaction is
// verified SERVER-SIDE against the provider API (including the paid amount),
// and only a verified result can mark the order as paid. Ambiguous
// verifications keep the transaction pending for reconciliation. The browser
// is finally redirected to the real result page /portal/payment/result.
//
// The redirect target is a RELATIVE Location (RFC 9110 §9.3.7): the browser
// resolves it against the origin it is already on (the public callback origin
// the provider used), so no Host/forwarded header is ever trusted for
// constructing redirect URLs.
import { NextResponse } from "next/server";
import { orderService } from "@/lib/commerce/orders";
import { handleRouteError } from "@/lib/api/http";

export async function GET(request: Request, { params }: { params: Promise<{ gateway: string }> }) {
  try {
    const { gateway } = await params;
    const query = new URL(request.url).searchParams;
    const target = await orderService.handleGatewayCallback(gateway, query);
    // 303 See Other with a relative Location — origin-safe by construction.
    return new NextResponse(null, {
      status: 303,
      headers: { Location: target },
    });
  } catch (error) {
    return handleRouteError(error, "payments/callback/[gateway]");
  }
}
