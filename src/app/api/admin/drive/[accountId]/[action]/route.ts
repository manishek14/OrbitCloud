// POST /api/admin/drive/[accountId]/[action] — sync | enable | disable |
// reset-provisioning a customer's Drive account (real Nextcloud operations,
// audited). reset-provisioning is the OPERATOR RECOVERY PATH for stuck
// reservation states (audit §5.2) — see driveService.adminResetProvisioning.
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { driveService } from "@/lib/drive/service";
import { apiError, handleRouteError } from "@/lib/api/http";
import { audit } from "@/lib/audit";

export async function POST(request: Request, context: { params: Promise<{ accountId: string; action: string }> }) {
  try {
    const staff = await requireAdminAccess("drive.manage", request);
    const { accountId, action } = await context.params;

    if (action === "sync") {
      const overview = await driveService.adminSync(accountId);
      await audit({ actor: staff, action: "drive.synced", entityType: "drive_account", entityId: accountId });
      return NextResponse.json({
        ok: true,
        message: `همگام‌سازی انجام شد — وضعیت: ${overview.state}`,
      });
    }
    if (action === "enable" || action === "disable") {
      const overview = await driveService.adminSetEnabled(accountId, action === "enable");
      await audit({ actor: staff, action: `drive.${action}d`, entityType: "drive_account", entityId: accountId });
      return NextResponse.json({
        ok: true,
        message: action === "enable" ? "حساب Drive فعال شد." : "حساب Drive غیرفعال شد.",
      });
    }
    if (action === "reset-provisioning") {
      const result = await driveService.adminResetProvisioning(accountId);
      await audit({
        actor: staff,
        action: "drive.provisioning_reset",
        entityType: "drive_account",
        entityId: accountId,
        meta: { outcome: result.action },
      });
      return NextResponse.json({ ok: true, message: result.message });
    }
    return apiError(400, "INVALID_ACTION", "عملیات مجاز نیست (sync | enable | disable | reset-provisioning).");
  } catch (error) {
    return handleRouteError(error, "admin/drive/action");
  }
}
