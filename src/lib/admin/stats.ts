// Admin dashboard aggregates & reports — every number comes from real DB
// rows. No invented statistics: empty states are surfaced honestly.

import { db } from "@/lib/db";
import { readCommercialCatalog } from "@/lib/commerce/catalog";
import { toOrderListEntry } from "@/lib/commerce/orders";
import type { AdminDashboardDTO, AdminReportDTO } from "@/lib/api/types";

export const adminStatsService = {
  async dashboard(): Promise<AdminDashboardDTO> {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

    const [
      customers,
      activeSubscriptions,
      newOrders,
      pendingPayments,
      confirmedRevenue,
      activeDriveAccounts,
      driveAccounts,
      pendingTickets,
      recentOrderRows,
      recentActivity,
      recentTransactionRows,
    ] = await Promise.all([
      db.panelUser.count({ where: { role: "customer" } }),
      db.subscription.count({ where: { status: "active", expiresAt: { gt: now } } }),
      db.order.count({ where: { createdAt: { gte: monthAgo } } }),
      db.order.count({ where: { status: "pending_payment" } }),
      db.transaction.aggregate({ where: { status: "succeeded" }, _sum: { amountToman: true } }),
      db.driveAccount.count({ where: { status: "active" } }),
      db.driveAccount.findMany({ select: { status: true } }),
      db.ticket.count({ where: { status: { in: ["open", "answered"] } } }),
      db.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { user: { select: { name: true } } },
      }),
      db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
      db.transaction.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { order: { select: { orderNumber: true } } },
      }),
    ]);

    return {
      totals: {
        customers,
        activeSubscriptions,
        newOrders,
        pendingPayments,
        confirmedRevenueToman: confirmedRevenue._sum.amountToman ?? 0,
        activeDriveAccounts,
        pendingTickets,
      },
      provisioning: {
        active: driveAccounts.filter((a) => a.status === "active").length,
        disabled: driveAccounts.filter((a) => a.status === "disabled").length,
        total: driveAccounts.length,
      },
      recentOrders: recentOrderRows.map((o) => ({
        ...toOrderListEntry(o),
        customerName: o.user?.name ?? null,
      })),
      recentTransactions: recentTransactionRows.map((t) => ({
        ref: t.ref,
        orderNumber: t.order?.orderNumber ?? null,
        gateway: t.gateway,
        amountToman: t.amountToman,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
      })),
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        actorLabel: a.actorLabel,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  },

  async reports(): Promise<AdminReportDTO> {
    const [paidTxs, allOrders, subs] = await Promise.all([
      db.transaction.findMany({ where: { status: "succeeded" }, select: { amountToman: true, finalizedAt: true, createdAt: true } }),
      db.order.findMany({ select: { status: true } }),
      db.subscription.findMany({ where: { status: "active" }, select: { packageCode: true } }),
    ]);

    // Revenue by month (YYYY-MM) for the last 6 months.
    const monthly = new Map<string, { totalToman: number; orderCount: number }>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i, 1);
      monthly.set(d.toISOString().slice(0, 7), { totalToman: 0, orderCount: 0 });
    }
    for (const tx of paidTxs) {
      const key = (tx.finalizedAt ?? tx.createdAt).toISOString().slice(0, 7);
      const entry = monthly.get(key);
      if (entry) {
        entry.totalToman += tx.amountToman;
        entry.orderCount += 1;
      }
    }

    const statusCount = new Map<string, number>();
    for (const o of allOrders) statusCount.set(o.status, (statusCount.get(o.status) ?? 0) + 1);

    const planCount = new Map<string, number>();
    for (const s of subs) planCount.set(s.packageCode, (planCount.get(s.packageCode) ?? 0) + 1);

    const catalog = await readCommercialCatalog();
    return {
      revenueByMonth: Array.from(monthly.entries()).map(([month, v]) => ({ month, ...v })),
      ordersByStatus: Array.from(statusCount.entries()).map(([status, count]) => ({ status, count })),
      planDistribution: Array.from(planCount.entries()).map(([packageCode, count]) => ({
        packageCode,
        packageNameFa: catalog.packages.find((p) => p.code === packageCode)?.nameFa ?? packageCode,
        count,
      })),
      totalPaidOrders: paidTxs.length,
      totalRevenueToman: paidTxs.reduce((sum, t) => sum + t.amountToman, 0),
    };
  },
};
