// DELETE /api/admin/media/[id] — remove a media asset.
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { mediaService } from "@/lib/media";
import { handleRouteError } from "@/lib/api/http";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireAdminAccess("media.manage", request);
    const { id } = await context.params;
    await mediaService.remove(staff, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "admin/media/[id]");
  }
}
