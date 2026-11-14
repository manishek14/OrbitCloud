// GET /api/drive/status — the signed-in user's Drive overview.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { driveService } from "@/lib/drive/service";
import { handleRouteError } from "@/lib/api/http";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await driveService.getOverview(user));
  } catch (error) {
    return handleRouteError(error, "drive/status");
  }
}
