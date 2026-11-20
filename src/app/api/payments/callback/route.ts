// POST /api/payments/callback — the INTERNAL dev/test gateway callback
// (enabled only via ABRIT_PAYMENTS_MOCK_ENABLED=true). Real providers
// (ZarinPal Sandbox / Zibal Sandbox) use GET /api/payments/callback/[gateway].
//
// Accepts the gateway form POST (ref + token + outcome), verifies the token
// against the stored hash, and finalizes the payment.
//
// REDIRECT SECURITY (final-integration FSR-7): the response is a 303 See Other
// with a RELATIVE Location (RFC 9110 §9.3.7) — exactly like the real-gateway
// callback. The destination is fully SERVER-CONTROLLED: the route never reads
// Host / X-Forwarded-Host / X-Forwarded-Proto (or any other request header)
// to build an origin, so a spoofed header cannot influence where the browser
// is sent. The relative target is validated by
// src/lib/payments/redirect-target.ts (one leading "/", never "//", never a
// backslash, never an absolute URL); anything unexpected collapses to "/".
//
// The internal gateway stays disabled in production: orderService.finalizePayment
// itself refuses to run when NODE_ENV=production (403 MOCK_DISABLED), and the
// mock gateway page is only rendered when ABRIT_PAYMENTS_MOCK_ENABLED=true in
// a non-production environment.

import { NextResponse } from "next/server";
import { orderService } from "@/lib/commerce/orders";
import { handleRouteError } from "@/lib/api/http";
import { safeRelativeRedirectLocation } from "@/lib/payments/redirect-target";

export async function POST(request: Request) {
  try {
    const form = await request.formData().catch(() => null);
    const ref = String(form?.get("ref") ?? "");
    const token = String(form?.get("t") ?? "");
    const rawOutcome = String(form?.get("outcome") ?? "");
    const outcome: "success" | "failure" | "cancel" =
      rawOutcome === "success" ? "success" : rawOutcome === "failure" ? "failure" : "cancel";

    const result = await orderService.finalizePayment(ref, token, outcome);
    // 303 See Other with a server-controlled RELATIVE Location — origin-safe
    // by construction (same pattern as the real-gateway callback route).
    return new NextResponse(null, {
      status: 303,
      headers: { Location: safeRelativeRedirectLocation(result.redirectUrl) },
    });
  } catch (error) {
    return handleRouteError(error, "payments/callback");
  }
}
