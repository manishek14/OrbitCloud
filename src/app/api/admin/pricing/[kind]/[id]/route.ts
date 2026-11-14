import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";
import { deletePricing, revision, updatePricing } from "@/lib/commerce/pricing-admin";

type Context = { params: Promise<{ kind: string; id: string }> };
const kindOf = (kind: string) => kind === "plans" || kind === "contracts" ? kind : null;

export async function PUT(request: Request, context: Context) {
  try {
    await requireAdminAccess("settings.manage", request);
    const { kind: raw, id } = await context.params;
    const kind = kindOf(raw);
    if (!kind) return apiError(404, "NOT_FOUND", "بخش یافت نشد.");
    const body = await readJson<{ revision?: unknown; payload?: unknown; active?: unknown }>(request);
    if (!body || (!Object.hasOwn(body, "payload") && typeof body.active !== "boolean") ||
      (Object.hasOwn(body, "active") && typeof body.active !== "boolean"))
      return apiError(400, "VALIDATION", "اطلاعات تغییر معتبر نیست.");
    return NextResponse.json(await updatePricing(kind, id, revision(body.revision), body.payload, body.active as boolean | undefined));
  } catch (error) { return handleRouteError(error, "admin/pricing PUT"); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    await requireAdminAccess("settings.manage", request);
    const { kind: raw, id } = await context.params;
    const kind = kindOf(raw);
    if (!kind) return apiError(404, "NOT_FOUND", "بخش یافت نشد.");
    const body = await readJson<{ revision?: unknown }>(request);
    return NextResponse.json(await deletePricing(kind, id, revision(body?.revision)));
  } catch (error) { return handleRouteError(error, "admin/pricing DELETE"); }
}
