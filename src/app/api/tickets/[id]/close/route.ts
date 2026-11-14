// POST /api/tickets/[id]/close — customer closes their ticket.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { ticketService } from "@/lib/support/tickets";
import { handleRouteError } from "@/lib/api/http";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    await ticketService.close(user, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "tickets/[id]/close");
  }
}
