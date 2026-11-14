// GET /api/payments/result?ref= — server-verified payment result for the
// result page.
//
// SECURITY:
//   • OWNERSHIP: the session user must own the transaction (admins included
//     for operations views); another customer's ref → 404, no existence leak.
//   • Rate limiting: pending transactions are re-verified server-side through
//     an internal per-ref throttle (min interval + bounded attempts), so page
//     polling never becomes a provider-request storm.
//   • A success state is never fabricated — it comes from the provider verify.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { orderService } from "@/lib/commerce/orders";
import { handleRouteError } from "@/lib/api/http";
import { selectableGateways } from "@/lib/payments/providers";

const GATEWAY_LABELS: Record<string, string> = Object.fromEntries(
  selectableGateways().map((g) => [g.gateway, g.labelFa]),
);

export async function GET(request: Request) {
  try {
    const ref = new URL(request.url).searchParams.get("ref") ?? "";
    if (!ref) {
      return NextResponse.json({ error: { code: "VALIDATION", message: "مرجع تراکنش مشخص نیست." } }, { status: 400 });
    }
    const user = await requireUser();
    // Reject another user's reference before any provider re-verification.
    await orderService.getPaymentResult(ref, user);
    // Re-verify pending real-gateway transactions (idempotent + throttled).
    await orderService.reverifyPendingTransaction(ref).catch(() => "pending");
    const result = await orderService.getPaymentResult(ref, user);
    return NextResponse.json({
      ...result,
      gatewayLabel: GATEWAY_LABELS[result.gateway] ?? result.gateway,
    });
  } catch (error) {
    return handleRouteError(error, "payments/result");
  }
}
