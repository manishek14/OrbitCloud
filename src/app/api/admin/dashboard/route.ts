// GET /api/admin/dashboard — real aggregates for the admin dashboard.
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { adminStatsService } from "@/lib/admin/stats";
import { handleRouteError } from "@/lib/api/http";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("dashboard.view", request);
    return NextResponse.json(await adminStatsService.dashboard());
  } catch (error) {
    return handleRouteError(error, "admin/dashboard");
  }
}
