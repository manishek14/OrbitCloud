// POST /api/contact — public contact form → sales ticket (guest).
import { NextResponse } from "next/server";
import { ticketService } from "@/lib/support/tickets";
import { handleRouteError, readJson } from "@/lib/api/http";
import { clientIpKey, consumeRateLimit } from "@/lib/rate-limit/memory";

// Abuse protection for the unauthenticated guest form (audit §3.3):
// 5 submissions per IP per 10 minutes.
const CONTACT_LIMIT = 5;
const CONTACT_WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const limit = consumeRateLimit(`contact:${clientIpKey(request)}`, CONTACT_LIMIT, CONTACT_WINDOW_MS);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: { code: "TOO_MANY_REQUESTS", message: "تعداد پیام‌های ارسالی از حد مجاز گذشته است؛ کمی بعد دوباره تلاش کنید." } },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }
    const body = await readJson<{ name?: string; email?: string; mobile?: string; subject?: string; message?: string }>(request);
    await ticketService.createGuest({
      name: String(body?.name ?? ""),
      email: String(body?.email ?? ""),
      mobile: body?.mobile ? String(body.mobile) : undefined,
      subject: String(body?.subject ?? ""),
      message: String(body?.message ?? ""),
    });
    return NextResponse.json(
      { ok: true, message: "پیام شما ثبت شد؛ کارشناسان AbrIT به‌زودی با شما تماس می‌گیرند." },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error, "contact");
  }
}
