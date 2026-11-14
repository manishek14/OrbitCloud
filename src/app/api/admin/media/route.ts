// GET/POST /api/admin/media — media library (list & upload).
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { mediaService } from "@/lib/media";
import { handleRouteError } from "@/lib/api/http";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("media.manage", request);
    return NextResponse.json(await mediaService.list());
  } catch (error) {
    return handleRouteError(error, "admin/media");
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requireAdminAccess("media.manage", request);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: { code: "NO_FILE", message: "فایلی ارسال نشد." } }, { status: 400 });
    }
    const asset = await mediaService.upload(staff, file);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "admin/media/upload");
  }
}
