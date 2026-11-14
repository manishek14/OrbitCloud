// POST /api/admin/tickets/[id]/messages — staff reply.
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { ticketService } from "@/lib/support/tickets";
import { handleRouteError, readJson } from "@/lib/api/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireAdminAccess("tickets.manage", request);
    const { id } = await context.params;
    const body = await readJson<{ body?: string }>(request);
    await ticketService.adminReply(staff, id, String(body?.body ?? ""));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "admin/tickets/[id]/messages");
  }
}
