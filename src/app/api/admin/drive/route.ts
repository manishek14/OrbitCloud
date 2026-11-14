// GET /api/admin/drive — all Drive accounts (provisioning overview).
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { driveService } from "@/lib/drive/service";
import { handleRouteError } from "@/lib/api/http";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("drive.manage", request);
    return NextResponse.json(await driveService.adminListAccounts());
  } catch (error) {
    return handleRouteError(error, "admin/drive");
  }
}
