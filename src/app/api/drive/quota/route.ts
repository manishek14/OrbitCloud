// POST /api/drive/quota — change the linked Drive account quota.
//
// ENTITLEMENT ENFORCEMENT: the customer may only switch to
//   • the free "trial" plan (100 MB — the standing free entitlement), or
//   • the plan they are actually entitled to by an ACTIVE subscription
//     (largest Drive quota among active subscriptions).
// Arbitrary paid quotas can never be self-assigned (audit finding: any
// authenticated user could previously self-assign 250 GB).

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/rbac";
import { driveService } from "@/lib/drive/service";
import { resolveActivatablePlan } from "@/lib/drive/entitlement-policy";
import { getEntitledPlanCode } from "@/lib/commerce/entitlement";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";

const schema = z.object({
  planCode: z.string().min(1, { message: "پلن را انتخاب کنید." }).max(32),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();

    const body = await readJson<unknown>(request);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return apiError(400, "VALIDATION", first?.message ?? "اطلاعات ورودی معتبر نیست.");
    }

    // Shared policy with /api/drive/activate (see entitlement-policy.ts).
    const entitled = await getEntitledPlanCode(user.id);
    const decision = resolveActivatablePlan(parsed.data.planCode, entitled);
    if (!decision.ok) {
      return apiError(
        403,
        "NOT_ENTITLED",
        "سهمیه انتخابی با اشتراک فعال شما مطابقت ندارد؛ برای سهمیه‌های بالاتر ابتدا پلن مربوطه را خریداری کنید.",
      );
    }

    const drive = await driveService.changeQuota(user, decision.planCode);
    return NextResponse.json({ ok: true, drive });
  } catch (error) {
    return handleRouteError(error, "quota");
  }
}
