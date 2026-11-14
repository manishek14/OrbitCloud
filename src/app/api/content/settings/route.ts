// GET /api/content/settings — public site settings (contact info, etc.).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleRouteError } from "@/lib/api/http";

const PUBLIC_KEYS = [
  "contact_phone",
  "contact_mobile",
  "contact_email",
  "contact_address",
  "contact_hours",
];

export async function GET() {
  try {
    const rows = await db.setting.findMany({ where: { key: { in: PUBLIC_KEYS } } });
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key] = row.value;
    return NextResponse.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, "content/settings");
  }
}
