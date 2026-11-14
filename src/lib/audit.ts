// Audit trail — every security-relevant mutation lands here (auth events,
// admin operations, payments, provisioning). Displayed in the admin
// Audit Log screen (mirrors Orchard's Audit Trail module).

import { db } from "@/lib/db";
import type { PanelUser } from "@prisma/client";

export interface AuditInput {
  actor?: PanelUser | null;
  actorLabel?: string;
  action: string; // e.g. "auth.login", "order.paid", "content.published"
  entityType: string; // e.g. "user", "order", "content"
  entityId?: string | null;
  meta?: Record<string, unknown>;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: input.actor?.id ?? null,
        actorLabel: input.actorLabel ?? input.actor?.name ?? input.actor?.email ?? "سیستم",
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metaJson: input.meta ? JSON.stringify(input.meta) : null,
      },
    });
  } catch (error) {
    // Auditing must never break the business operation.
    console.error("[audit] failed to write log:", error);
  }
}
