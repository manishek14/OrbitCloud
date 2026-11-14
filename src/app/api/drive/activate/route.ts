// POST /api/drive/activate — provision (or safely recover) the customer's
// AbrIT Drive (Nextcloud) account.
//
// ENTITLEMENT ENFORCEMENT (audit fix): the request body's planCode is NEVER
// trusted. The activatable plan is resolved server-side from the customer's
// ACTIVE subscriptions (or the standing free "trial" tier) — see
// resolveActivatablePlan(). A tampered planCode can never yield a higher
// quota; a mismatching request is rejected with 403 BEFORE any Nextcloud call.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { driveService } from "@/lib/drive/service";
import { resolveActivatablePlan } from "@/lib/drive/entitlement-policy";
import { getEntitledPlanCode } from "@/lib/commerce/entitlement";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";
import { orderService } from "@/lib/commerce/orders";
import { notificationService } from "@/lib/notifications";
import { audit } from "@/lib/audit";

const schema = z.object({
  username: z.string().min(1, { message: "نام کاربری Drive را وارد کنید." }).max(64),
  password: z.string().min(1, { message: "رمز عبور Drive را وارد کنید." }).max(128),
  planCode: z.string().min(1, { message: "پلن را انتخاب کنید." }).max(32),
});

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError(401, "NOT_AUTHENTICATED", "برای فعال‌سازی سرویس Drive باید وارد پنل شوید.");
    if (user.status === "disabled") {
      return apiError(403, "ACCOUNT_DISABLED", "حساب کاربری شما غیرفعال است؛ با پشتیبانی تماس بگیرید.");
    }

    const body = await readJson<unknown>(request);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return apiError(400, "VALIDATION", first?.message ?? "اطلاعات ورودی معتبر نیست.");
    }

    // Server-side entitlement decision — the client cannot self-select a plan.
    const entitled = await getEntitledPlanCode(user.id);
    const decision = resolveActivatablePlan(parsed.data.planCode, entitled);
    if (!decision.ok) {
      await audit({
        actor: user,
        action: "drive.activation.rejected",
        entityType: "drive_account",
        entityId: parsed.data.username,
        meta: { requestedPlanCode: parsed.data.planCode, entitledPlanCode: entitled },
      });
      return apiError(
        403,
        "NOT_ENTITLED",
        "پلن انتخابی با اشتراک فعال شما مطابقت ندارد؛ برای سهمیه‌های بالاتر ابتدا پلن مربوطه را خریداری کنید.",
      );
    }
    const planCode = decision.planCode;

    const drive = await driveService.activate(user, {
      username: parsed.data.username,
      password: parsed.data.password,
      planCode,
    });
    // Register the Drive service record + notify the customer.
    await orderService.ensureDriveServiceRecord(user, planCode, parsed.data.username);
    await notificationService.notify(user.id, {
      category: "drive",
      title: "سرویس AbrIT Drive فعال شد",
      body: `حساب Drive شما با نام کاربری ${parsed.data.username} ساخته شد و سهمیه آن اعمال گردید.`,
      link: "/portal/drive",
    });
    await audit({
      actor: user,
      action: "drive.provisioned",
      entityType: "drive_account",
      entityId: parsed.data.username,
      meta: { planCode, entitledPlanCode: entitled },
    });
    return NextResponse.json({ ok: true, drive }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "activate");
  }
}
