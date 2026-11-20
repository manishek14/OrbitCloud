// POST /api/commerce/quote — server-side quote computation.
//
// Quote completeness is kept separate from checkout authorization: the
// response always carries checkoutEnabled:false in this release (the secure
// order/payment lifecycle is not complete — audit PAY-14 and §6.1 of the
// task: "Real checkout must remain disabled until the secure order/payment
// lifecycle is complete").
//
// The response includes an immutable snapshot (quoteId + SHA-256 checksum)
// that a future order flow can persist and verify — fixing COM-11 where the
// Orchard snapshot mechanism existed but was never wired to any order.

import { NextResponse } from "next/server";
import { z } from "zod";
import { computeQuote } from "@/lib/commerce/quote";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";
import { clientIpKey, consumeRateLimit } from "@/lib/rate-limit/memory";

// Abuse protection for the unauthenticated quote endpoint (audit §3.3):
// 30 computations per IP per minute.
const QUOTE_LIMIT = 30;
const QUOTE_WINDOW_MS = 60 * 1000;

const schema = z.object({
  packageCode: z.string().min(1, { message: "پکیج را انتخاب کنید." }).max(64),
  months: z.number().int().min(1).max(120),
  users: z.number().int().min(0).max(10_000),
  endpoints: z.number().int().min(0).max(10_000),
});

export async function POST(request: Request) {
  try {
    const limit = consumeRateLimit(`quote:${clientIpKey(request)}`, QUOTE_LIMIT, QUOTE_WINDOW_MS);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: { code: "TOO_MANY_REQUESTS", message: "تعداد درخواست‌ها از حد مجاز گذشته است؛ کمی بعد دوباره تلاش کنید." } },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }
    const body = await readJson<unknown>(request);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return apiError(400, "VALIDATION", first?.message ?? "اطلاعات ورودی معتبر نیست.");
    }
    const result = await computeQuote({
      packageCode: parsed.data.packageCode,
      months: parsed.data.months,
      users: parsed.data.users,
      endpoints: parsed.data.endpoints,
    });
    // Invalid quotes are data-level results (HTTP 200) so the client can show
    // the field-level errors; transport-level failures stay non-2xx.
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, "commerce/quote");
  }
}
