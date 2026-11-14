// GET /api/admin/tickets — all tickets (filterable by status).
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { ticketService } from "@/lib/support/tickets";
import { handleRouteError } from "@/lib/api/http";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("tickets.manage", request);
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    return NextResponse.json(await ticketService.adminList(status || undefined));
  } catch (error) {
    return handleRouteError(error, "admin/tickets");
  }
}
