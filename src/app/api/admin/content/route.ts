// GET/POST /api/admin/content — list & create content items.
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { contentService } from "@/lib/content";
import { handleRouteError, readJson } from "@/lib/api/http";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("content.manage", request);
    const type = new URL(request.url).searchParams.get("type") ?? undefined;
    return NextResponse.json(await contentService.adminList(type || undefined));
  } catch (error) {
    return handleRouteError(error, "admin/content");
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requireAdminAccess("content.manage", request);
    const body = await readJson<{ type?: string; title?: string; slug?: string; excerpt?: string; body?: string; status?: string; sortOrder?: number }>(request);
    const item = await contentService.create(staff, {
      type: String(body?.type ?? "page"),
      title: String(body?.title ?? ""),
      slug: body?.slug ? String(body.slug) : undefined,
      excerpt: body?.excerpt ? String(body.excerpt) : undefined,
      body: body?.body ? String(body.body) : "",
      status: body?.status ? String(body.status) : "draft",
      sortOrder: body?.sortOrder ? Number(body.sortOrder) : 0,
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "admin/content/create");
  }
}
