// GET /api/admin/queries — content query (filter by type/status/search).
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { mediaService } from "@/lib/media";
import { handleRouteError } from "@/lib/api/http";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("queries.view", request);
    const url = new URL(request.url);
    const items = await mediaService.queryContent({
      type: url.searchParams.get("type") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
    });
    return NextResponse.json(items);
  } catch (error) {
    return handleRouteError(error, "admin/queries");
  }
}
