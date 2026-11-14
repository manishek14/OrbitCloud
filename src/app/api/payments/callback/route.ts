// POST /api/payments/callback — the INTERNAL dev/test gateway callback
// (enabled only via ABRIT_PAYMENTS_MOCK_ENABLED=true). Real providers
// (ZarinPal Sandbox / Zibal Sandbox) use GET /api/payments/callback/[gateway].
//
// Accepts the gateway form POST (ref + token + outcome), verifies the token
// against the stored hash, and finalizes the payment. Redirects the browser
// to the real result page path.

import { NextResponse } from "next/server";
import { orderService } from "@/lib/commerce/orders";
import { handleRouteError } from "@/lib/api/http";

function baseUrl(request: Request): string {
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  return `${proto}://${host}`;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData().catch(() => null);
    const ref = String(form?.get("ref") ?? "");
    const token = String(form?.get("t") ?? "");
    const rawOutcome = String(form?.get("outcome") ?? "");
    const outcome: "success" | "failure" | "cancel" =
      rawOutcome === "success" ? "success" : rawOutcome === "failure" ? "failure" : "cancel";

    const result = await orderService.finalizePayment(ref, token, outcome);
    return NextResponse.redirect(`${baseUrl(request)}${result.redirectUrl}`, 303);
  } catch (error) {
    return handleRouteError(error, "payments/callback");
  }
}
