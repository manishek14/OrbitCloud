// GET /api/profile/sessions — active sessions of the signed-in user.
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/rbac";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { handleRouteError } from "@/lib/api/http";

export async function GET() {
  try {
    const user = await requireUser();
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    const tokenHash = token ? createHash("sha256").update(token).digest("hex") : "";
    const sessions = await db.session.findMany({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
    });
    return NextResponse.json(
      sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        current: s.tokenHash === tokenHash,
      })),
    );
  } catch (error) {
    return handleRouteError(error, "profile/sessions");
  }
}
