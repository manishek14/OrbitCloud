// Read-only report for legacy subscriptions without purchased-term snapshots.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
try {
  const subs = await db.subscription.findMany({
    where: { entitlementJson: null },
    select: { id: true, userId: true, packageCode: true, orderId: true },
  });
  for (const sub of subs) {
    const account = await db.driveAccount.findUnique({ where: { panelUserId: sub.userId }, select: { planCode: true, quotaBytes: true } });
    console.log(JSON.stringify({
      subscriptionId: sub.id, orderId: sub.orderId,
      status: "manual_reconciliation_required",
      operationalQuotaBytes: account?.planCode === sub.packageCode ? String(account.quotaBytes) : null,
    }));
  }
} finally {
  await db.$disconnect();
}
