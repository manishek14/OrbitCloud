// DELETE /api/profile/sessions/[id] — revoke one session (not the current one).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/rbac";
import { apiError, handleRouteError } from "@/lib/api/http";
import { audit } from "@/lib/audit";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const session = await db.session.findFirst({ where: { id, userId: user.id } });
    if (!session) return apiError(404, "NOT_FOUND", "نشست یافت نشد.");
    await db.session.delete({ where: { id: session.id } });
    await audit({ actor: user, action: "security.session_revoked", entityType: "session", entityId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "profile/sessions/[id]");
  }
}
