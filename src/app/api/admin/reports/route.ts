// GET /api/admin/reports — revenue & distribution reports.
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { adminStatsService } from "@/lib/admin/stats";
import { handleRouteError } from "@/lib/api/http";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("reports.view", request);
    return NextResponse.json(await adminStatsService.reports());
  } catch (error) {
    return handleRouteError(error, "admin/reports");
  }
}
