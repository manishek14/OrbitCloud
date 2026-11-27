// Subscription entitlements: which commercial package is the customer
// entitled to right now (drives the Orbit Drive quota mapping).
// Quotas are ALWAYS derived from the catalog — never stored twice.

import { db } from "@/lib/db";
import type { Subscription } from "@prisma/client";

/** Active = not cancelled and not past its expiry date. */
export function isSubscriptionActive(sub: Subscription, now = Date.now()): boolean {
  return sub.status === "active" && sub.expiresAt.getTime() > now;
}

export async function getActiveSubscriptions(userId: string): Promise<Subscription[]> {
  const subs = await db.subscription.findMany({
    where: { userId, status: "active" },
    orderBy: { expiresAt: "desc" },
  });
  const now = Date.now();
  return subs.filter((s) => isSubscriptionActive(s, now));
}

export function resolveSubscriptionQuota(
  sub: Pick<Subscription, "packageCode" | "entitlementJson">,
  account: { planCode: string; quotaBytes: bigint } | null,
): number | null {
  if (sub.entitlementJson) {
    try {
      const terms = JSON.parse(sub.entitlementJson) as { planCode?: string; driveQuotaBytes?: number };
      if (terms.planCode === sub.packageCode && Number.isSafeInteger(terms.driveQuotaBytes) && terms.driveQuotaBytes! >= 0)
        return terms.driveQuotaBytes!;
    } catch { /* malformed snapshot requires reconciliation */ }
    return null;
  }
  if (account?.planCode === sub.packageCode) {
    const quota = Number(account.quotaBytes);
    return Number.isSafeInteger(quota) && quota >= 0 ? quota : null;
  }
  return null;
}

/**
 * The entitled plan = the active subscription with the LARGEST Drive quota
 * (a customer upgrading keeps the bigger quota until it expires).
 * Returns null when the customer has no active subscription (trial Drive only).
 */
export async function getEntitledPlan(userId: string): Promise<{ code: string; quotaBytes: number } | null> {
  const subs = await getActiveSubscriptions(userId);
  const account = await db.driveAccount.findUnique({ where: { panelUserId: userId } });
  let best: { code: string; quota: number } | null = null;
  for (const sub of subs) {
    // Legacy orders did not record storage. A matching operational allocation
    // is the only safe legacy evidence; malformed snapshots require review.
    const quota = resolveSubscriptionQuota(sub, account);
    if (quota === null) continue;
    if (!best || quota > best.quota) {
      best = { code: sub.packageCode, quota };
    }
  }
  return best ? { code: best.code, quotaBytes: best.quota } : null;
}

export async function getEntitledPlanCode(userId: string): Promise<string | null> {
  return (await getEntitledPlan(userId))?.code ?? null;
}
