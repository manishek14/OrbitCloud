// GET /api/payments/gateways — customer-selectable payment methods.
// ZarinPal Sandbox + Zibal Sandbox; Bank Mellat is disabled and never listed.
// The list mirrors the server-side provider registry (single source of truth).
import { NextResponse } from "next/server";
import { selectableGateways } from "@/lib/payments/providers";

export async function GET() {
  return NextResponse.json(selectableGateways());
}
