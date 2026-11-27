// Readiness probe: a running HTTP process is not ready if PostgreSQL is down.
// The payload also reports the ACTUAL integration status of external systems
// (SMS delivery, Nextcloud/Drive) — configuration only, never credentials,
// and never a fabricated "live" state (audit §5.4). Nextcloud mode reports
// what is configured: simulation is visible as such, and a broken/unsafe
// production configuration surfaces as not_configured instead of pretending.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSmsIrConfig } from "@/lib/sms/smsir";
import { getNextcloudConfig } from "@/lib/nextcloud/config";

export async function GET() {
  let dbStatus: "up" | "down" = "down";
  try {
    await db.$queryRaw`SELECT 1`;
    dbStatus = "up";
  } catch {
    dbStatus = "down";
  }

  let drive: { mode: "live" | "simulation"; configured: boolean } = { mode: "simulation", configured: false };
  try {
    const config = getNextcloudConfig();
    drive = { mode: config.mode, configured: config.configured };
  } catch {
    // Production with NEXTCLOUD_MODE=simulation (or another invalid config)
    // — report not configured rather than crashing the health probe.
    drive = { mode: "live", configured: false };
  }

  return NextResponse.json(
    {
      ok: dbStatus === "up",
      service: "orbit-portal",
      db: dbStatus,
      integrations: {
        sms: getSmsIrConfig().configured ? "configured" : "not_configured",
        drive,
      },
      time: new Date().toISOString(),
    },
    { status: dbStatus === "up" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
