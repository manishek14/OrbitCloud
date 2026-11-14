// GET /api/me — session user + portal context (unread notifications, Drive entitlement).
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { notificationService } from "@/lib/notifications";
import { getEntitledPlanCode } from "@/lib/commerce/entitlement";
import { toPublicUser } from "@/lib/api/serialize";
import { handleRouteError } from "@/lib/api/http";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ user: null, role: null, unreadNotifications: 0, entitledPlanCode: null });
    }
    const [unreadNotifications, entitledPlanCode] = await Promise.all([
      notificationService.unreadCount(user.id),
      getEntitledPlanCode(user.id),
    ]);
    return NextResponse.json({
      user: toPublicUser(user),
      role: user.role,
      unreadNotifications,
      entitledPlanCode,
    });
  } catch (error) {
    return handleRouteError(error, "me");
  }
}
