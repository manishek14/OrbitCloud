// GET /api/admin/customers — paginated customer directory with real aggregates.
//
// Response envelope (full-remediation audit §3.2): { items, page, pageSize,
// total, totalPages }. The page size is capped server-side; search, filters
// and sorting are validated against fixed whitelists. The previous version
// returned an unbounded array and ran 4 queries per customer (N+1).
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { adminCustomerService, type CustomerSort } from "@/lib/admin/customers";
import { handleRouteError } from "@/lib/api/http";

const SORT_WHITELIST: CustomerSort[] = ["newest", "oldest", "name", "email"];
const ROLE_WHITELIST = ["admin", "staff", "customer"];
const STATUS_WHITELIST = ["active", "disabled"];
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

export async function GET(request: Request) {
  try {
    await requireAdminAccess("customers.view", request);
    const params = new URL(request.url).searchParams;

    const sortParam = params.get("sort") ?? "newest";
    const sort: CustomerSort = SORT_WHITELIST.includes(sortParam as CustomerSort) ? (sortParam as CustomerSort) : "newest";

    const roleParam = params.get("role") ?? undefined;
    const statusParam = params.get("status") ?? undefined;
    const role = roleParam && ROLE_WHITELIST.includes(roleParam) ? roleParam : undefined;
    const status = statusParam && STATUS_WHITELIST.includes(statusParam) ? statusParam : undefined;

    const pageSize = Math.min(MAX_PAGE_SIZE, positiveInt(params.get("pageSize"), DEFAULT_PAGE_SIZE));
    const page = positiveInt(params.get("page"), 1);

    const result = await adminCustomerService.list({
      query: params.get("query") ?? undefined,
      role,
      status,
      page,
      pageSize,
      sort,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "admin/customers");
  }
}
