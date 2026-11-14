// GET/PATCH/DELETE /api/admin/content/[id] — content item CRUD.
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { contentService } from "@/lib/content";
import { handleRouteError, readJson } from "@/lib/api/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminAccess("content.manage", request);
    const { id } = await context.params;
    return NextResponse.json(await contentService.adminGet(id));
  } catch (error) {
    return handleRouteError(error, "admin/content/[id]");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireAdminAccess("content.manage", request);
    const { id } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    const item = await contentService.update(staff, id, {
      ...(body?.title !== undefined ? { title: String(body.title) } : {}),
      ...(body?.excerpt !== undefined ? { excerpt: String(body.excerpt) } : {}),
      ...(body?.body !== undefined ? { body: String(body.body) } : {}),
      ...(body?.status !== undefined ? { status: String(body.status) } : {}),
      ...(body?.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) } : {}),
      ...(body?.slug !== undefined ? { slug: String(body.slug) } : {}),
    });
    return NextResponse.json(item);
  } catch (error) {
    return handleRouteError(error, "admin/content/[id] PATCH");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireAdminAccess("content.manage", request);
    const { id } = await context.params;
    await contentService.remove(staff, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "admin/content/[id] DELETE");
  }
}
