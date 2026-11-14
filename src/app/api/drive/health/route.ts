import { NextResponse } from "next/server";
import { getNextcloudConfig } from "@/lib/nextcloud/config";
import { nextcloudClient } from "@/lib/nextcloud/client";
import { isNextcloudError } from "@/lib/nextcloud/errors";
import { handleRouteError } from "@/lib/api/http";

interface HealthSnapshot {
  mode: "live" | "simulation";
  configured: boolean;
  reachable: boolean;
  version: string;
  productname: string;
  loginUrl: string;
  loginUrlLabel: string;
  message: string;
  fetchedAt: string;
}

let cached: { expiresAt: number; snapshot: HealthSnapshot } | null = null;
const HEALTH_CACHE_MS = 60_000;

export async function GET() {
  try {
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.snapshot);
    }

    const config = getNextcloudConfig();
    let snapshot: HealthSnapshot;
    if (!config.configured) {
      snapshot = {
        mode: config.mode,
        configured: false,
        reachable: false,
        version: "",
        productname: "",
        loginUrl: config.loginUrl,
        loginUrlLabel: "ورود به AbrIT Drive",
        message: "اتصال AbrIT Drive هنوز پیکربندی نشده است.",
        fetchedAt: new Date().toISOString(),
      };
    } else {
      try {
        const ping = await nextcloudClient.ping();
        snapshot = {
          mode: config.mode,
          configured: true,
          reachable: true,
          version: ping.version,
          productname: ping.productname,
          loginUrl: config.loginUrl,
          loginUrlLabel: config.mode === "live" ? "ورود به AbrIT Drive" : "ورود به AbrIT Drive (شبیه‌سازی)",
          message:
            config.mode === "live"
              ? `اتصال واقعی برقرار است — Nextcloud ${ping.version}`
              : `حالت شبیه‌سازی فعال است — شبیه‌ساز Nextcloud ${ping.version}`,
          fetchedAt: new Date().toISOString(),
        };
      } catch (error) {
        const detail =
          isNextcloudError(error) && error.code === "NC_AUTH_FAILED"
            ? "اعتبارنامه اتصال Drive پذیرفته نشد."
            : "سرور Drive در دسترس نیست.";
        snapshot = {
          mode: config.mode,
          configured: true,
          reachable: false,
          version: "",
          productname: "",
          loginUrl: config.loginUrl,
          loginUrlLabel: "ورود به AbrIT Drive",
          message: detail,
          fetchedAt: new Date().toISOString(),
        };
      }
    }

    cached = { expiresAt: Date.now() + HEALTH_CACHE_MS, snapshot };
    return NextResponse.json(snapshot);
  } catch (error) {
    return handleRouteError(error, "health");
  }
}
