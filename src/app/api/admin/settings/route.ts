// GET/POST /api/admin/settings — environment status (read) + public contact
// settings (write). Secrets are never returned.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { getNextcloudConfig } from "@/lib/nextcloud/config";
import { otpDeliveryMode } from "@/lib/auth/otp";
import { recoveryDeliveryMode } from "@/lib/auth/recovery";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";
import { audit } from "@/lib/audit";
import type { AdminSettingsDTO } from "@/lib/api/types";

const PUBLIC_KEYS = ["contact_phone", "contact_mobile", "contact_email", "contact_address", "contact_hours"];

export async function GET(request: Request) {
  try {
    await requireAdminAccess("settings.manage", request);
    const nc = getNextcloudConfig();
    const settings: AdminSettingsDTO = {
      nextcloud: {
        mode: nc.mode,
        configured: nc.configured,
        loginUrl: nc.loginUrl,
      },
      payments: [
        {
          gateway: "zarinpal",
          labelFa: "زرین‌پال (Sandbox)",
          enabled: true,
          noteFa: "درگاه آزمایشی زرین‌پال فعال است — تأیید پرداخت فقط از طریق استعلام سمت سرور (pg/v4 verify).",
        },
        {
          gateway: "zibal",
          labelFa: "زیبال (Sandbox)",
          enabled: true,
          noteFa: "درگاه آزمایشی زیبال فعال است — تأیید پرداخت فقط از طریق استعلام سمت سرور (v1/verify).",
        },
        {
          gateway: "mellat",
          labelFa: "به‌پرداخت ملت",
          enabled: false,
          noteFa: "طبق تصمیم پیکربندی غیرفعال است؛ در هیچ مسیر پرداختی قابل انتخاب نیست.",
        },
        {
          gateway: "mock",
          labelFa: "درگاه داخلی تست",
          enabled: false,
          noteFa: "فقط محیط توسعه (ABRIT_PAYMENTS_MOCK_ENABLED) — در تولید غیرفعال.",
        },
      ],
      otpDelivery: otpDeliveryMode(),
      recoveryDelivery: recoveryDeliveryMode(),
    };
    return NextResponse.json(settings);
  } catch (error) {
    return handleRouteError(error, "admin/settings");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdminAccess("settings.manage", request);
    const body = await readJson<Record<string, string>>(request);
    if (!body || typeof body !== "object") {
      return apiError(400, "VALIDATION", "ورودی معتبر نیست.");
    }
    const allowed = Object.entries(body).filter(([key, value]) => PUBLIC_KEYS.includes(key) && typeof value === "string" && value.length <= 200);
    if (allowed.length === 0) {
      return apiError(400, "VALIDATION", "تنظیم قابل‌ثبتی ارسال نشد.");
    }
    for (const [key, value] of allowed) {
      await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    await audit({ actor, action: "settings.updated", entityType: "settings", meta: { keys: allowed.map(([k]) => k) } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "admin/settings POST");
  }
}
