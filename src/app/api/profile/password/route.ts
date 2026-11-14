// POST /api/profile/password — change the panel password (requires current).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { requireUser } from "@/lib/auth/rbac";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";
import { audit } from "@/lib/audit";
import { notificationService } from "@/lib/notifications";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await readJson<{ currentPassword?: string; newPassword?: string }>(request);
    const currentPassword = String(body?.currentPassword ?? "");
    const newPassword = String(body?.newPassword ?? "");
    if (!currentPassword || !newPassword) {
      return apiError(400, "VALIDATION", "رمز عبور فعلی و جدید را وارد کنید.");
    }
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      return apiError(401, "BAD_CREDENTIALS", "رمز عبور فعلی صحیح نیست.");
    }
    if (newPassword.length < 8 || newPassword.length > 128 || !/[A-Za-zآ-ی]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return apiError(400, "WEAK_PASSWORD", "رمز عبور جدید باید حداقل ۸ نویسه و شامل حرف و رقم باشد.");
    }
    await db.panelUser.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(newPassword) },
    });
    await audit({ actor: user, action: "security.password_changed", entityType: "user", entityId: user.id });
    await notificationService.notify(user.id, {
      category: "security",
      title: "رمز عبور تغییر کرد",
      body: "رمز عبور پنل شما با موفقیت تغییر کرد. اگر این کار را شما انجام نداده‌اید فوراً با پشتیبانی تماس بگیرید.",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "profile/password");
  }
}
