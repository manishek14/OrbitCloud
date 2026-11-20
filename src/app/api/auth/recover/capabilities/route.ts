// GET /api/auth/recover/capabilities — tells the UI which password-recovery
// channels are ACTUALLY available right now (audit §4.4: the UI must never
// offer or imply a delivery method that cannot deliver).
//
//   • mobile: SMS OTP recovery through SMS.ir. Available when SMS delivery is
//     configured (production) — in development the OTP display mode makes the
//     flow usable without provider credentials.
//   • email: requires RECOVERY_DELIVERY_MODE=email AND a real email provider
//     (RECOVERY_EMAIL_PROVIDER_URL). No provider is integrated yet, so email
//     reports itself as unavailable in production instead of pretending.

import { NextResponse } from "next/server";
import { emailRecoveryAvailable } from "@/lib/auth/recovery";
import { getSmsIrConfig } from "@/lib/sms/smsir";

export function GET() {
  const isProduction = process.env.NODE_ENV === "production";
  const smsConfigured = getSmsIrConfig().configured;
  return NextResponse.json(
    {
      channels: {
        // Production: real SMS delivery only. Development: display mode works
        // without credentials (the code is returned and clearly labeled).
        mobile: isProduction ? smsConfigured : true,
        email: emailRecoveryAvailable(),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
