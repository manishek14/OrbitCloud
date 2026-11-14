// GET/POST /api/admin/recipes — export content as a recipe / import a recipe.
// Mirrors Orchard's Recipes concept (portable content packages).
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { contentService } from "@/lib/content";
import { handleRouteError, readJson } from "@/lib/api/http";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("recipes.manage", request);
    return NextResponse.json(await contentService.exportRecipe());
  } catch (error) {
    return handleRouteError(error, "admin/recipes");
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requireAdminAccess("recipes.manage", request);
    const body = await readJson<{ contentItems?: Array<Record<string, unknown>> }>(request);
    const result = await contentService.importRecipe(staff, body ?? {});
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return handleRouteError(error, "admin/recipes/import");
  }
}
