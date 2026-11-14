// GET /api/notifications — the customer's notifications.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { notificationService } from "@/lib/notifications";
import { handleRouteError } from "@/lib/api/http";

export async function GET() {
  try {
    const user = await requireUser();
    const notifications = await notificationService.list(user.id);
    return NextResponse.json(
      notifications.map((n) => ({
        id: n.id,
        category: n.category,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    );
  } catch (error) {
    return handleRouteError(error, "notifications");
  }
}
