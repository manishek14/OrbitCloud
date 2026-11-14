// POST /api/auth/otp/request — issue a mobile OTP (login or registration).
import { NextResponse } from "next/server";
import { otpService } from "@/lib/auth/otp";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";
import { audit } from "@/lib/audit";
import { randomUUID } from "node:crypto";

export async function POST(request: Request) {
  const correlationId = randomUUID();
  try {
    const body = await readJson<{ mobile?: string; purpose?: string }>(request);
    const purpose = body?.purpose === "register" ? "register" : "login";
    console.info("[otp.request]", { correlationId, purpose, stage: "received" });
    const result = await otpService.requestGrant(request, String(body?.mobile ?? ""), purpose, correlationId);
    await audit({
      actorLabel: "کاربر مهمان",
      action: `otp.requested.${purpose}`,
      entityType: "auth",
      meta: { delivery: result.delivery },
    });
    console.info("[otp.request]", { correlationId, purpose, stage: "completed", delivery: result.delivery });
    return NextResponse.json(result, { headers: { "X-Correlation-Id": correlationId } });
  } catch (error) {
    const response = handleRouteError(error, "auth/otp/request");
    response.headers.set("X-Correlation-Id", correlationId);
    console.warn("[otp.request]", { correlationId, stage: "failed", errorCode: error instanceof Error && "code" in error ? String(error.code) : "INTERNAL" });
    return response;
  }
}

export function GET() {
  return apiError(405, "METHOD_NOT_ALLOWED", "این مسیر فقط POST را می‌پذیرد.");
}
