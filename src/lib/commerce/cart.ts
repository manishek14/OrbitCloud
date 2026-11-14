// Server-side shopping cart. Items are package configurations
// (packageCode, months, users, endpoints); the price of every item is
// ALWAYS recomputed by the quote engine server-side — the stored snapshot
// is only kept for display, never trusted at checkout.

import { db } from "@/lib/db";
import type { PanelUser } from "@prisma/client";
import { HttpError } from "@/lib/api/http";
import { computeQuote, type QuoteInput } from "@/lib/commerce/quote";
import type { CartItemDTO, CartResponse } from "@/lib/api/types";

function validateInput(input: QuoteInput): QuoteInput {
  const months = Number(input.months);
  const users = Number(input.users);
  const endpoints = Number(input.endpoints);
  if (!Number.isSafeInteger(months) || months < 1 || months > 120) {
    throw new HttpError(400, "INVALID_MONTHS", "مدت قرارداد فقط می‌تواند ۱ ماهه، ۳ ماهه یا ۶ ماهه باشد.");
  }
  if (!Number.isInteger(users) || users < 1 || users > 200) {
    throw new HttpError(400, "INVALID_USERS", "تعداد کاربر معتبر نیست.");
  }
  if (!Number.isInteger(endpoints) || endpoints < 1 || endpoints > 300) {
    throw new HttpError(400, "INVALID_ENDPOINTS", "تعداد Endpoint معتبر نیست.");
  }
  return {
    packageCode: String(input.packageCode ?? "").trim().toLowerCase(),
    months,
    users,
    endpoints,
  };
}

export const cartService = {
  async addItem(user: PanelUser, rawInput: QuoteInput): Promise<CartResponse> {
    const input = validateInput(rawInput);
    const quote = await computeQuote(input);
    if (!quote.valid || !quote.breakdown) {
      throw new HttpError(400, "INVALID_QUOTE", quote.errors[0] ?? "پیکربندی انتخابی قابل قیمت‌گذاری نیست.");
    }
    if (quote.needsCustomAssessment) {
      throw new HttpError(
        422,
        "NEEDS_CUSTOM_ASSESSMENT",
        "برای بیش از ۴۰ کاربر یا ۶۰ Endpoint، پکیج Enterprise Custom پس از Assessment اولیه به‌صورت جداگانه برآورد می‌شود؛ از صفحه تماس با ما درخواست ثبت کنید.",
      );
    }
    // One configuration per package in the cart (a second config of the same
    // package would create a duplicate subscription).
    const existing = await db.cartItem.findFirst({ where: { userId: user.id, packageCode: input.packageCode } });
    if (existing) {
      await db.cartItem.update({
        where: { id: existing.id },
        data: { ...input, snapshotJson: JSON.stringify(quote.snapshot) },
      });
    } else {
      await db.cartItem.create({
        data: {
          userId: user.id,
          ...input,
          snapshotJson: JSON.stringify(quote.snapshot),
        },
      });
    }
    return this.getCart(user);
  },

  /** Fresh server-side quotes for every item (prices are never cached client-side). */
  async getCart(user: PanelUser): Promise<CartResponse> {
    const rows = await db.cartItem.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    const items: CartItemDTO[] = [];
    let totalToman = 0;
    for (const row of rows) {
      const quote = await computeQuote({
        packageCode: row.packageCode,
        months: row.months,
        users: row.users,
        endpoints: row.endpoints,
      });
      if (!quote.valid || !quote.breakdown) continue; // catalog changed → item no longer quotable
      totalToman += quote.breakdown.totalToman;
      items.push({
        id: row.id,
        input: {
          packageCode: row.packageCode,
          months: row.months,
          users: row.users,
          endpoints: row.endpoints,
        },
        quote,
        addedAt: row.createdAt.toISOString(),
      });
    }
    return { items, totalToman, count: items.length };
  },

  async removeItem(user: PanelUser, itemId: string): Promise<CartResponse> {
    await db.cartItem.deleteMany({ where: { id: itemId, userId: user.id } });
    return this.getCart(user);
  },

  async clear(userId: string): Promise<void> {
    await db.cartItem.deleteMany({ where: { userId } });
  },
};
