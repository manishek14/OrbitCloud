// POST /api/tickets/[id]/messages — customer reply.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { ticketService } from "@/lib/support/tickets";
import { handleRouteError, readJson } from "@/lib/api/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await readJson<{ body?: string }>(request);
    const ticket = await ticketService.reply(user, id, String(body?.body ?? ""));
    return NextResponse.json({ ticket });
  } catch (error) {
    return handleRouteError(error, "tickets/[id]/messages");
  }
}
