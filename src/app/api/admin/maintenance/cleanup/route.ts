// POST /api/admin/maintenance/cleanup — documented retention policy for
// short-lived security records (audit §6). Admin-only, idempotent, returns
// the exact purge counts. Dry-run mode reports what WOULD be purged.
//
// Retention policy (see docs/DEPLOYMENT.md):
//   • OtpGrant / RecoveryGrant rows older than 24h (consumed or expired —
//     both are dead by then: max TTL is 10 minutes).
//   • Session rows expired more than 7 days ago.
//   • LoginAttempt rows older than 30 days (throttling window is 15 min).
//   • SmsOutbox rows older than 90 days (delivery audit trail).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminAccess } from "@/lib/auth/rbac";
import { apiError, handleRouteError, readJson } from "@/lib/api/http";
import { audit } from "@/lib/audit";

const OTP_GRANT_RETENTION_MS = 24 * 60 * 60 * 1000;
const RECOVERY_GRANT_RETENTION_MS = 24 * 60 * 60 * 1000;
const SESSION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_ATTEMPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SMS_OUTBOX_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const staff = await requireAdminAccess("settings.manage", request);
    const body = await readJson<{ dryRun?: boolean }>(request);
    const dryRun = Boolean(body?.dryRun);

    const otpCutoff = new Date(Date.now() - OTP_GRANT_RETENTION_MS);
    const recoveryCutoff = new Date(Date.now() - RECOVERY_GRANT_RETENTION_MS);
    const sessionCutoff = new Date(Date.now() - SESSION_GRACE_MS);
    const attemptCutoff = new Date(Date.now() - LOGIN_ATTEMPT_RETENTION_MS);
    const outboxCutoff = new Date(Date.now() - SMS_OUTBOX_RETENTION_MS);

    const plan = {
      otpGrants: await db.otpGrant.count({ where: { createdAt: { lt: otpCutoff } } }),
      recoveryGrants: await db.recoveryGrant.count({ where: { createdAt: { lt: recoveryCutoff } } }),
      sessions: await db.session.count({ where: { expiresAt: { lt: sessionCutoff } } }),
      loginAttempts: await db.loginAttempt.count({ where: { createdAt: { lt: attemptCutoff } } }),
      smsOutbox: await db.smsOutbox.count({ where: { createdAt: { lt: outboxCutoff } } }),
    };

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, wouldPurge: plan });
    }

    const purged = {
      otpGrants: await db.otpGrant.deleteMany({ where: { createdAt: { lt: otpCutoff } } }).then((r) => r.count),
      recoveryGrants: await db.recoveryGrant.deleteMany({ where: { createdAt: { lt: recoveryCutoff } } }).then((r) => r.count),
      sessions: await db.session.deleteMany({ where: { expiresAt: { lt: sessionCutoff } } }).then((r) => r.count),
      loginAttempts: await db.loginAttempt.deleteMany({ where: { createdAt: { lt: attemptCutoff } } }).then((r) => r.count),
      smsOutbox: await db.smsOutbox.deleteMany({ where: { createdAt: { lt: outboxCutoff } } }).then((r) => r.count),
    };

    await audit({
      actor: staff,
      action: "maintenance.cleanup",
      entityType: "system",
      meta: { purged },
    });

    return NextResponse.json({ ok: true, dryRun: false, purged });
  } catch (error) {
    return handleRouteError(error, "admin/maintenance/cleanup");
  }
}

export function GET() {
  return apiError(405, "METHOD_NOT_ALLOWED", "این مسیر فقط POST را می‌پذیرد.");
}
