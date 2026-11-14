import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Readiness probe: a running HTTP process is not ready if PostgreSQL is down.
export async function GET() {
  let dbStatus: "up" | "down" = "down";
  try {
    await db.$queryRaw`SELECT 1`;
    dbStatus = "up";
  } catch {
    dbStatus = "down";
  }

  return NextResponse.json({
    ok: dbStatus === "up",
    service: "abrit-portal",
    db: dbStatus,
    time: new Date().toISOString(),
  }, { status: dbStatus === "up" ? 200 : 503 });
}
