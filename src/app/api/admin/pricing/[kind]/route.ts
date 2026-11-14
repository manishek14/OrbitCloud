import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";
import { createPricing } from "@/lib/commerce/pricing-admin";
import { readCommercialCatalog } from "@/lib/commerce/catalog";

type Context = { params: Promise<{ kind: string }> };
const kindOf = (kind: string) => kind === "plans" || kind === "contracts" ? kind : null;

export async function GET(request: Request, context: Context) {
  try {
    await requireAdminAccess("settings.manage", request);
    const kind = kindOf((await context.params).kind);
    if (!kind) return apiError(404, "NOT_FOUND", "بخش یافت نشد.");
    const catalog = await readCommercialCatalog();
    return NextResponse.json(kind === "plans" ? catalog.packages : catalog.contracts, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleRouteError(error, "admin/pricing GET"); }
}

export async function POST(request: Request, context: Context) {
  try {
    await requireAdminAccess("settings.manage", request);
    const kind = kindOf((await context.params).kind);
    if (!kind) return apiError(404, "NOT_FOUND", "بخش یافت نشد.");
    const body = await readJson<{ payload?: unknown }>(request);
    if (!body || !Object.hasOwn(body, "payload")) return apiError(400, "VALIDATION", "اطلاعات ارسال نشد.");
    return NextResponse.json(await createPricing(kind, body.payload), { status: 201 });
  } catch (error) { return handleRouteError(error, "admin/pricing POST"); }
}
