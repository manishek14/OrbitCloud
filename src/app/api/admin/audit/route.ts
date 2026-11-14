// GET /api/admin/audit — the audit trail (most recent first).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { handleRouteError } from "@/lib/api/http";
import type { AdminAuditDTO } from "@/lib/api/types";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("audit.view", request);
    const logs = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    const result: AdminAuditDTO[] = logs.map((l) => ({
      id: l.id,
      actorLabel: l.actorLabel,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      metaJson: l.metaJson,
      createdAt: l.createdAt.toISOString(),
    }));
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "admin/audit");
  }
}
