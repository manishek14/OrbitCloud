// POST /api/auth/recover/request — step 1 of password recovery.
//
// Two channels:
//   • email  — durable, single-use recovery grant (uniform responses, no
//     account-existence disclosure). In the sandbox's demo delivery mode the
//     code is returned once for existing accounts only; production must set
//     RECOVERY_DELIVERY_MODE=email.
//   • mobile — OTP delivered through SMS.ir (OTP_DELIVERY_MODE=sms). The code
//     is NEVER returned by the API in sms mode. Same uniform-response rule.

import { NextResponse } from "next/server";
import { z } from "zod";
import { recoveryService, RecoveryError } from "@/lib/auth/recovery";
import { otpService } from "@/lib/auth/otp";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";

const schema = z
  .object({
    email: z.email({ message: "ایمیل معتبر نیست." }).max(190).optional(),
    mobile: z.string().trim().min(10, { message: "شماره همراه معتبر نیست." }).max(20).optional(),
  })
  .refine((v) => Boolean(v.email ?? v.mobile), { message: "ایمیل یا شماره همراه را وارد کنید." });

export async function POST(request: Request) {
  try {
    const body = await readJson<unknown>(request);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return apiError(400, "VALIDATION", first?.message ?? "اطلاعات ورودی معتبر نیست.");
    }
    if (parsed.data.mobile) {
      const result = await otpService.requestGrant(request, parsed.data.mobile, "recover");
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    const result = await recoveryService.requestGrant(request, parsed.data.email as string);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RecoveryError) {
      return apiError(error.httpStatus, error.code, error.publicMessage);
    }
    return handleRouteError(error, "recover/request");
  }
}
