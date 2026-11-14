// GET /api/content — public published content (FAQ, services, pages).
// No authentication; drafts and admin data are never exposed here.
import { NextResponse } from "next/server";
import { contentService } from "@/lib/content";
import { handleRouteError } from "@/lib/api/http";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? undefined;
    const slug = url.searchParams.get("slug") ?? undefined;
    const items = await contentService.publicList(type, slug);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, "content");
  }
}
