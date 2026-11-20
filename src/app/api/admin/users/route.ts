// GET /api/admin/users — panel users incl. admins/staff (admin only).
//
// Full-remediation audit §3.3: the previous version fabricated zero
// aggregates (orderCount: 0, paidTotalToman: 0, …) — fake data on an admin
// screen. It now returns the SAME paginated envelope with REAL aggregates
// computed by the shared admin customer service.
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { adminCustomerService } from "@/lib/admin/customers";
import { handleRouteError } from "@/lib/api/http";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

export async function GET(request: Request) {
  try {
    await requireAdminAccess("settings.manage", request);
    const params = new URL(request.url).searchParams;
    const result = await adminCustomerService.list({
      query: params.get("query") ?? undefined,
      page: positiveInt(params.get("page"), 1),
      pageSize: Math.min(MAX_PAGE_SIZE, positiveInt(params.get("pageSize"), DEFAULT_PAGE_SIZE)),
      sort: "newest",
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "admin/users");
  }
}
