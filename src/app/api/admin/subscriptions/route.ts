// GET /api/admin/subscriptions — all subscriptions with customer info.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { toSubscriptionDTO } from "@/lib/commerce/orders";
import { handleRouteError } from "@/lib/api/http";

export async function GET(request: Request) {
  try {
    await requireAdminAccess("subscriptions.view", request);
    const subs = await db.subscription.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true, name: true } } },
    });
    return NextResponse.json(
      subs.map((s) => ({
        ...toSubscriptionDTO(s),
        customerEmail: s.user.email,
        customerName: s.user.name,
      })),
    );
  } catch (error) {
    return handleRouteError(error, "admin/subscriptions");
  }
}
