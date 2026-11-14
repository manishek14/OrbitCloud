// POST /api/notifications/read — mark all (or selected) notifications read.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { notificationService } from "@/lib/notifications";
import { handleRouteError, readJson } from "@/lib/api/http";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await readJson<{ ids?: string[]; all?: boolean }>(request);
    await notificationService.markRead(user.id, body?.ids);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "notifications/read");
  }
}
