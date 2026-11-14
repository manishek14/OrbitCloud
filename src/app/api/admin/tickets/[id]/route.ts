// GET /api/admin/tickets/[id] — ticket detail (staff view).
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { ticketService } from "@/lib/support/tickets";
import { handleRouteError } from "@/lib/api/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminAccess("tickets.manage", request);
    const { id } = await context.params;
    return NextResponse.json(await ticketService.adminGet(id));
  } catch (error) {
    return handleRouteError(error, "admin/tickets/[id]");
  }
}
