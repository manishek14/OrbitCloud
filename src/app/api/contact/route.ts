// POST /api/contact — public contact form → sales ticket (guest).
import { NextResponse } from "next/server";
import { ticketService } from "@/lib/support/tickets";
import { handleRouteError, readJson } from "@/lib/api/http";

export async function POST(request: Request) {
  try {
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
