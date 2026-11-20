// Admin customer directory service (full-remediation audit §3.1–3.2).
//
// All aggregates (order counts, paid totals, Drive linkage, active
// subscriptions) are computed with BATCHED queries — a fixed number of
// database round-trips per page regardless of the page size, replacing the
// previous per-user loop (4N+2 queries) that scaled linearly with the
// customer count. Every number comes from real rows; nothing is fabricated.

import { db } from "@/lib/db";
import { readCommercialCatalog } from "@/lib/commerce/catalog";
import type { AdminCustomerDTO } from "@/lib/api/types";

export type CustomerSort = "newest" | "oldest" | "name" | "email";

export interface CustomerListQuery {
  /** Free-text search over email/name/mobile/company. */
  query?: string;
  /** Optional role filter (validated by the caller against the role enum). */
  role?: string;
  /** Optional status filter (validated by the caller against the status enum). */
  status?: string;
  page: number;
  pageSize: number;
  sort: CustomerSort;
}

export interface CustomerListResult {
  items: AdminCustomerDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const SORT_OPTIONS: Record<CustomerSort, { createdAt?: "asc" | "desc"; name?: "asc" | "desc"; email?: "asc" | "desc" }> = {
  newest: { createdAt: "desc" },
  oldest: { createdAt: "asc" },
  name: { name: "asc" },
  email: { email: "asc" },
};

/** Single-user projection shared by the list and the detail endpoint. */
interface UserRow {
  id: string;
  email: string;
  name: string | null;
  mobile: string | null;
  company: string | null;
  role: string;
  status: string;
  createdAt: Date;
  lastLoginAt: Date | null;
}

async function toCustomerDTOs(
  users: UserRow[],
  catalog: Awaited<ReturnType<typeof readCommercialCatalog>>,
): Promise<AdminCustomerDTO[]> {
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return [];

  const [orderCounts, paidSums, driveRows, subscriptionRows] = await Promise.all([
    db.order.groupBy({ by: ["userId"], _count: { _all: true }, where: { userId: { in: ids } } }),
    db.transaction.groupBy({
      by: ["userId"],
      _sum: { amountToman: true },
      where: { userId: { in: ids }, status: "succeeded" },
    }),
    db.driveAccount.findMany({ where: { panelUserId: { in: ids } }, select: { panelUserId: true } }),
    db.subscription.findMany({
      where: { userId: { in: ids }, status: "active", expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: "desc" },
      select: { userId: true, packageCode: true },
    }),
  ]);

  const orderCountById = new Map(orderCounts.map((row) => [row.userId, row._count._all]));
  const paidTotalById = new Map(paidSums.map((row) => [row.userId, row._sum.amountToman ?? 0]));
  const driveById = new Set(driveRows.map((row) => row.panelUserId));
  const activeSubscriptionByUser = new Map<string, string>(); // userId → Persian plan name
  for (const sub of subscriptionRows) {
    if (!activeSubscriptionByUser.has(sub.userId)) {
      activeSubscriptionByUser.set(
        sub.userId,
        catalog.packages.find((p) => p.code === sub.packageCode)?.nameFa ?? sub.packageCode,
      );
    }
  }

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    mobile: u.mobile,
    company: u.company,
    role: (u.role as AdminCustomerDTO["role"]) ?? "customer",
    status: (u.status as AdminCustomerDTO["status"]) ?? "active",
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    orderCount: orderCountById.get(u.id) ?? 0,
    paidTotalToman: paidTotalById.get(u.id) ?? 0,
    hasDrive: driveById.has(u.id),
    activeSubscription: activeSubscriptionByUser.get(u.id) ?? null,
  }));
}

export const adminCustomerService = {
  /** Paginated, searchable, sortable customer directory (bounded page size). */
  async list(q: CustomerListQuery): Promise<CustomerListResult> {
    const search = (q.query ?? "").trim();
    const where = {
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" as const } },
              { name: { contains: search, mode: "insensitive" as const } },
              { mobile: { contains: search } },
              { company: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(q.role ? { role: q.role } : {}),
      ...(q.status ? { status: q.status } : {}),
    };

    const [total, users] = await Promise.all([
      db.panelUser.count({ where }),
      db.panelUser.findMany({
        where,
        orderBy: SORT_OPTIONS[q.sort] ?? SORT_OPTIONS.newest,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          email: true,
          name: true,
          mobile: true,
          company: true,
          role: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
    ]);

    const catalog = await readCommercialCatalog();
    const items = await toCustomerDTOs(users, catalog);
    return {
      items,
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  },

  /** Single customer detail — the DTO shape the Orchard admin expects. */
  async get(id: string): Promise<AdminCustomerDTO | null> {
    const user = await db.panelUser.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        mobile: true,
        company: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    if (!user) return null;
    const catalog = await readCommercialCatalog();
    const [dto] = await toCustomerDTOs([user], catalog);
    return dto ?? null;
  },
};
