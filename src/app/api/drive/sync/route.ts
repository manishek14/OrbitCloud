import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { driveService } from "@/lib/drive/service";
import { apiError, handleRouteError } from "@/lib/api/http";

export async function POST() {
  try {
    const user = await requireUser();
    const drive = await driveService.sync(user);
    return NextResponse.json({ ok: true, drive });
  } catch (error) {
    return handleRouteError(error, "sync");
  }
}
