// GET/POST /api/tickets — list & create support tickets.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { ticketService } from "@/lib/support/tickets";
import { handleRouteError, readJson } from "@/lib/api/http";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await ticketService.list(user.id));
  } catch (error) {
    return handleRouteError(error, "tickets");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await readJson<{ subject?: string; category?: string; priority?: string; body?: string }>(request);
    const ticket = await ticketService.create(user, {
      subject: String(body?.subject ?? ""),
      category: String(body?.category ?? "other"),
      priority: String(body?.priority ?? "normal"),
      body: String(body?.body ?? ""),
    });
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "tickets/create");
  }
}
