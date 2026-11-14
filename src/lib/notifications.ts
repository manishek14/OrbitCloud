// In-app notifications (portal bell + notifications page).
// Created by real backend events only (orders, payments, provisioning,
// tickets, security) — never fabricated.

import { db } from "@/lib/db";

export interface NotificationInput {
  category: "order" | "payment" | "drive" | "ticket" | "system" | "security";
  title: string;
  body: string;
  /** Hash-route link, e.g. "/portal/orders" (without #). */
  link?: string | null;
}

export const notificationService = {
  async notify(userId: string, input: NotificationInput): Promise<void> {
    try {
      await db.notification.create({
        data: {
          userId,
          category: input.category,
          title: input.title,
          body: input.body,
          link: input.link ?? null,
        },
      });
    } catch (error) {
      console.error("[notifications] create failed:", error);
    }
  },

  /** Fan-out to every active admin/staff account (e.g. new ticket). */
  async notifyAdmins(input: NotificationInput): Promise<void> {
    try {
      const admins = await db.panelUser.findMany({
        where: { role: { in: ["admin", "staff"] }, status: "active" },
        select: { id: true },
      });
      if (admins.length === 0) return;
      await db.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          category: input.category,
          title: input.title,
          body: input.body,
          link: input.link ?? null,
        })),
      });
    } catch (error) {
      console.error("[notifications] admin fan-out failed:", error);
    }
  },

  async list(userId: string, limit = 50) {
    return db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  async unreadCount(userId: string): Promise<number> {
    return db.notification.count({ where: { userId, readAt: null } });
  },

  async markRead(userId: string, ids?: string[]): Promise<void> {
    await db.notification.updateMany({
      where: { userId, readAt: null, ...(ids && ids.length > 0 ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
  },
};
