// PATCH /api/profile — update the signed-in customer's profile.
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/rbac";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";
import { audit } from "@/lib/audit";
import { toPublicUser } from "@/lib/api/serialize";

const schema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  company: z.string().trim().max(120).optional(),
});

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = await readJson<unknown>(request);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return apiError(400, "VALIDATION", first?.message ?? "اطلاعات ورودی معتبر نیست.");
    }
    const updated = await db.panelUser.update({
      where: { id: user.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.company !== undefined ? { company: parsed.data.company || null } : {}),
      },
    });
    await audit({ actor: user, action: "profile.updated", entityType: "user", entityId: user.id });
    return NextResponse.json({ user: toPublicUser(updated) });
  } catch (error) {
    return handleRouteError(error, "profile");
  }
}
