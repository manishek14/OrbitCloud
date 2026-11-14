// POST /api/admin/tickets/[id]/close — staff closes a ticket.
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { ticketService } from "@/lib/support/tickets";
import { handleRouteError } from "@/lib/api/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireAdminAccess("tickets.manage", request);
    const { id } = await context.params;
    await ticketService.adminClose(staff, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "admin/tickets/[id]/close");
  }
}
