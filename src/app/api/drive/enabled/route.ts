import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/rbac";
import { driveService } from "@/lib/drive/service";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";

const schema = z.object({
  enabled: z.boolean(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();

    const body = await readJson<unknown>(request);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return apiError(400, "VALIDATION", "پارامتر enabled باید مقدار بولی باشد.");
    }

    const drive = await driveService.setEnabled(user, parsed.data.enabled);
    return NextResponse.json({ ok: true, drive });
  } catch (error) {
    return handleRouteError(error, "enabled");
  }
}
