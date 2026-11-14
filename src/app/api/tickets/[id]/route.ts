// GET /api/tickets/[id] — ticket detail with messages (ownership enforced).
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { ticketService } from "@/lib/support/tickets";
import { handleRouteError } from "@/lib/api/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    return NextResponse.json(await ticketService.get(user.id, id));
  } catch (error) {
    return handleRouteError(error, "tickets/[id]");
  }
}
