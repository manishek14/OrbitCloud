// ============================================================================
// Orders, payments, invoices, subscriptions and fulfillment.
//
// Flow (all prices server-side, immutable snapshots, audited):
//   cart → checkout() → Order(pending_payment)
//   → initiatePayment(orderId, gateway)  [ZarinPal Sandbox | Zibal Sandbox]
//     • server selects + validates the provider (Mellat always rejected)
//     • provider request happens server-side; authority/trackId is stored on
//       the transaction (unique) and the customer's browser is redirected to
//       the REAL provider sandbox payment page
//   → provider redirects the browser to /api/payments/callback/<gateway>
//   → handleGatewayCallback(): server-to-server verification with the
//     provider (the ONLY trust anchor) + amount/order/reference validation
//   → finalizeSuccess() — the single success path: Transaction(succeeded) +
//     Order(paid) + Invoice + Subscription + Service records + Drive quota +
//     notifications + audit.
//   → browser lands on /portal/payment/result?ref=... (real path) which only
//     ever reports server-verified state and re-verifies pending transactions.
//
// The internal mock gateway (dev-only, ABRIT_PAYMENTS_MOCK_ENABLED) keeps the
// legacy token-based finalizePayment path; it is never selectable in
// production. Bank Mellat is disabled and rejected everywhere.
// ============================================================================

import { randomBytes, randomInt, createHash } from "node:crypto";
import { db, type PrismaTransactionClient } from "@/lib/db";
import type { Order, Invoice, Transaction, Subscription, Service, PanelUser } from "@prisma/client";
import { HttpError } from "@/lib/api/http";
import { computeQuote, verifySnapshotSnapshotChecksum } from "@/lib/commerce/quote";
import { getEntitledPlanCode, getActiveSubscriptions, resolveSubscriptionQuota } from "@/lib/commerce/entitlement";
import { driveService } from "@/lib/drive/service";
import { getPlan } from "@/lib/drive/plans";
import { notificationService } from "@/lib/notifications";
import { audit } from "@/lib/audit";
import { selectGateway, type PaymentProvider } from "@/lib/payments/providers";
import type {
  OrderDTO,
  OrderItemSnapshotDTO,
  OrderListEntryDTO,
  InvoiceDTO,
  PaymentResultDTO,
  TransactionDTO,
  SubscriptionDTO,
  ServiceDTO,
  PortalDashboardDTO,
  PaymentInitDTO,
} from "@/lib/api/types";

type OrderItemRow = {
  input: { packageCode: string; months: number; users: number; endpoints: number };
  packageNameFa: string;
  totalToman: number;
  lineItems: OrderItemSnapshotDTO["lineItems"];
  breakdown: OrderItemSnapshotDTO["breakdown"];
  snapshot: OrderItemSnapshotDTO["snapshot"];
  purchasedTerms?: NonNullable<Awaited<ReturnType<typeof computeQuote>>["purchasedTerms"]>;
};

function randomRef(prefix: string): string {
  return `${prefix}-${randomInt(10000000, 99999999)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseItems(order: Order): OrderItemRow[] {
  try {
    return JSON.parse(order.itemsJson) as OrderItemRow[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Reverify throttle — protects the payment provider from per-poll storms.
// The result page polls every 4s while a transaction is pending; without this
// guard every poll would become a provider verify call. Per ref: at most one
// call per VERIFY_MIN_INTERVAL_MS and at most VERIFY_MAX_ATTEMPTS calls total.
// ---------------------------------------------------------------------------

const VERIFY_MIN_INTERVAL_MS = 3000;
const VERIFY_MAX_ATTEMPTS = 40; // ≈ 2 minutes of polling, then manual review

const reverifyThrottle = (() => {
  const state = new Map<string, { lastAt: number; count: number }>();
  let lastSweep = Date.now();

  function sweep() {
    if (Date.now() - lastSweep < 60_000) return;
    lastSweep = Date.now();
    for (const [key, entry] of state) {
      if (Date.now() - entry.lastAt > 30 * 60_000) state.delete(key);
    }
  }

  return {
    check(ref: string): boolean {
      sweep();
      const entry = state.get(ref);
      const now = Date.now();
      if (entry) {
        if (entry.count >= VERIFY_MAX_ATTEMPTS) return false;
        if (now - entry.lastAt < VERIFY_MIN_INTERVAL_MS) return false;
        entry.lastAt = now;
        entry.count += 1;
        return true;
      }
      state.set(ref, { lastAt: now, count: 1 });
      return true;
    },
  };
})();

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function toOrderDTO(order: Order): OrderDTO {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status as OrderDTO["status"],
    itemCount: order.itemCount,
    totalToman: order.totalToman,
    items: parseItems(order) as unknown as OrderItemSnapshotDTO[],
    invoiceTitle: order.invoiceTitle,
    invoiceCompany: order.invoiceCompany,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
  };
}

function toOrderListEntry(order: Order): OrderListEntryDTO {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status as OrderListEntryDTO["status"],
    itemCount: order.itemCount,
    totalToman: order.totalToman,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
  };
}

function toInvoiceDTO(invoice: Invoice & { order: Order }): InvoiceDTO {
  return {
    id: invoice.id,
    number: invoice.number,
    orderId: invoice.orderId,
    orderNumber: invoice.order.orderNumber,
    amountToman: invoice.amountToman,
    status: invoice.status as InvoiceDTO["status"],
    title: invoice.title,
    company: invoice.company,
    issuedAt: invoice.issuedAt.toISOString(),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    items: parseItems(invoice.order) as unknown as OrderItemSnapshotDTO[],
  };
}

function toTransactionDTO(tx: Transaction & { order: Order }): TransactionDTO {
  return {
    id: tx.id,
    ref: tx.ref,
    orderNumber: tx.order.orderNumber,
    gateway: tx.gateway,
    amountToman: tx.amountToman,
    status: tx.status as TransactionDTO["status"],
    createdAt: tx.createdAt.toISOString(),
    finalizedAt: tx.finalizedAt?.toISOString() ?? null,
  };
}

function toSubscriptionDTO(sub: Subscription): SubscriptionDTO {
  let purchasedName: string | undefined;
  try { purchasedName = sub.entitlementJson ? (JSON.parse(sub.entitlementJson) as { planNameFa?: string }).planNameFa : undefined; } catch { /* legacy */ }
  return {
    id: sub.id,
    packageCode: sub.packageCode,
    packageNameFa: purchasedName ?? sub.packageCode,
    months: sub.months,
    users: sub.users,
    endpoints: sub.endpoints,
    status: sub.status as SubscriptionDTO["status"],
    startsAt: sub.startsAt.toISOString(),
    expiresAt: sub.expiresAt.toISOString(),
    priceTotalToman: sub.priceTotalToman,
    driveQuotaBytes: resolveSubscriptionQuota(sub, null),
    createdAt: sub.createdAt.toISOString(),
  };
}

function toServiceDTO(service: Service): ServiceDTO {
  let metadata: ServiceDTO["metadata"] = {};
  try {
    metadata = JSON.parse(service.metadataJson);
  } catch {
    metadata = {};
  }
  return {
    id: service.id,
    type: service.type as ServiceDTO["type"],
    title: service.title,
    status: service.status as ServiceDTO["status"],
    activatedAt: service.activatedAt?.toISOString() ?? null,
    expiresAt: service.expiresAt?.toISOString() ?? null,
    subscriptionId: service.subscriptionId,
    metadata,
    createdAt: service.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Service API
// ---------------------------------------------------------------------------

export const orderService = {
  /** Creates an order from the cart. Prices are recomputed from the inputs. */
  async checkout(
    user: PanelUser,
    input: { invoiceTitle: string; invoiceCompany?: string },
  ): Promise<OrderDTO> {
    const invoiceTitle = String(input.invoiceTitle ?? "").trim();
    if (invoiceTitle.length < 2) {
      throw new HttpError(400, "INVALID_TITLE", "عنوان گیرنده فاکتور را وارد کنید (حداقل ۲ نویسه).");
    }
    const { order, totalToman } = await db.$transaction(async (tx) => {
    // Serialize catalog mutations with checkout through the persisted order.
    await tx.$executeRawUnsafe('LOCK TABLE "PricingPlan", "PricingContract" IN SHARE MODE');
    const cart = await tx.cartItem.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    if (cart.length === 0) {
      throw new HttpError(400, "EMPTY_CART", "سبد خرید شما خالی است.");
    }

    const items: OrderItemRow[] = [];
    let totalToman = 0;
    for (const row of cart) {
      const quote = await computeQuote({
        packageCode: row.packageCode,
        months: row.months,
        users: row.users,
        endpoints: row.endpoints,
      });
      if (!quote.valid || !quote.breakdown || !quote.snapshot) {
        throw new HttpError(409, "ITEM_NOT_QUOTABLE", "یکی از اقلام سبد خرید دیگر قابل قیمت‌گذاری نیست؛ آن را حذف و دوباره انتخاب کنید.");
      }
      if (!verifySnapshotSnapshotChecksum(quote.snapshot)) {
        throw new HttpError(500, "CHECKSUM_FAILED", "خطای یکپارچگی قیمت؛ لطفاً دوباره تلاش کنید.");
      }
      items.push({
        input: {
          packageCode: row.packageCode,
          months: row.months,
          users: row.users,
          endpoints: row.endpoints,
        },
        packageNameFa: quote.breakdown.packageNameFa,
        totalToman: quote.breakdown.totalToman,
        lineItems: quote.lineItems,
        breakdown: quote.breakdown,
        snapshot: quote.snapshot,
        purchasedTerms: quote.purchasedTerms,
      });
      totalToman += quote.breakdown.totalToman;
    }

    const order = await tx.order.create({
      data: {
        orderNumber: randomRef("ABR"),
        userId: user.id,
        status: "pending_payment",
        itemsJson: JSON.stringify(items),
        itemCount: items.length,
        totalToman,
        invoiceTitle,
        invoiceCompany: input.invoiceCompany?.trim() || null,
      },
    });
    await tx.cartItem.deleteMany({ where: { userId: user.id } });
    return { order, totalToman };
    });

    await audit({
      actor: user,
      action: "order.created",
      entityType: "order",
      entityId: order.id,
      meta: { orderNumber: order.orderNumber, totalToman },
    });
    await notificationService.notify(user.id, {
      category: "order",
      title: "سفارش ثبت شد",
      body: `سفارش ${order.orderNumber} با مبلغ ${totalToman.toLocaleString("en-US")} تومان ثبت شد و در انتظار پرداخت است.`,
      link: "/portal/orders",
    });

    return toOrderDTO(order);
  },

  /**
   * Creates a pending transaction with a REAL payment provider (ZarinPal
   * Sandbox / Zibal Sandbox) and returns the provider payment-page URL for a
   * full-page browser redirect. Mellat is rejected here unconditionally.
   */
  async initiatePayment(
    user: PanelUser,
    orderId: string,
    gatewayId: string,
    origin: string,
  ): Promise<PaymentInitDTO> {
    const order = await db.order.findFirst({ where: { id: orderId, userId: user.id } });
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "سفارش یافت نشد.");
    if (order.status !== "pending_payment") {
      throw new HttpError(409, "ORDER_NOT_PAYABLE", "این سفارش در وضعیت قابل پرداخت نیست.");
    }
    if (!Number.isSafeInteger(order.totalToman) || order.totalToman < 1000 ||
        !Number.isSafeInteger(order.totalToman * 10)) {
      throw new HttpError(400, "INVALID_AMOUNT", "مبلغ سفارش برای پرداخت معتبر نیست.");
    }

    const selection = selectGateway(gatewayId);
    if ("error" in selection) {
      throw new HttpError(400, "GATEWAY_UNAVAILABLE", selection.error);
    }
    const provider = selection.provider;

    if (provider.id === "mock") {
      // Dev-only internal test gateway (legacy token flow).
      const ref = randomRef("MOCK");
      const verifyToken = randomBytes(24).toString("base64url");
      await db.transaction.create({
        data: {
          ref,
          orderId: order.id,
          userId: user.id,
          gateway: "mock",
          amountToman: order.totalToman,
          status: "pending",
          verifyTokenHash: sha256(verifyToken),
        },
      });
      await audit({
        actor: user,
        action: "payment.initiated",
        entityType: "transaction",
        entityId: ref,
        meta: { gateway: "mock", orderNumber: order.orderNumber, amountToman: order.totalToman },
      });
      return {
        ref,
        gatewayUrl: `/api/payments/gateway/${ref}?t=${encodeURIComponent(verifyToken)}`,
        amountToman: order.totalToman,
      };
    }

    // Real provider: request the payment server-side.
    const ref = randomRef(provider.id === "zarinpal" ? "ZPL" : "ZBL");
    const callbackUrl = `${origin}/api/payments/callback/${provider.id}`;
    let initiated;
    try {
      initiated = await provider.initiate({
        amountToman: order.totalToman,
        orderNumber: order.orderNumber,
        description: `پرداخت سفارش ${order.orderNumber} — AbrIT`,
        callbackUrl,
      });
    } catch (error) {
      // Provider request failed (network/credentials/rate limit): record the
      // failed attempt for observability and surface a safe error.
      await db.transaction.create({
        data: {
          ref,
          orderId: order.id,
          userId: user.id,
          gateway: provider.id,
          amountToman: order.totalToman,
          status: "failed",
          finalizedAt: new Date(),
          rawResultJson: JSON.stringify({
            phase: "initiate",
            error: error instanceof Error ? error.message : "unknown",
            at: new Date().toISOString(),
          }),
        },
      });
      await audit({
        actor: user,
        action: "payment.initiation_failed",
        entityType: "transaction",
        entityId: ref,
        meta: { gateway: provider.id, orderNumber: order.orderNumber },
      });
      throw new HttpError(
        502,
        "GATEWAY_REQUEST_FAILED",
        "درخواست پرداخت به درگاه انتخابی ارسال نشد؛ لطفاً درگاه دیگری انتخاب کنید یا کمی بعد دوباره تلاش کنید.",
      );
    }

    await db.transaction.create({
      data: {
        ref,
        orderId: order.id,
        userId: user.id,
        gateway: provider.id,
        amountToman: order.totalToman,
        status: "pending",
        gatewayRef: initiated.gatewayRef,
        rawResultJson: JSON.stringify({ phase: "initiate", at: new Date().toISOString(), result: initiated.raw }),
      },
    });
    await audit({
      actor: user,
      action: "payment.initiated",
      entityType: "transaction",
      entityId: ref,
      meta: { gateway: provider.id, orderNumber: order.orderNumber, amountToman: order.totalToman },
    });

    return { ref, gatewayUrl: initiated.redirectUrl, amountToman: order.totalToman };
  },

  /**
   * Handles the provider's browser-redirect callback. Verification happens
   * SERVER-SIDE against the provider API; a browser "success" flag alone is
   * never trusted. Returns the RELATIVE redirect target for the browser (the
   * result page on the same origin the provider sent the user back to).
   */
  async handleGatewayCallback(
    gatewayId: string,
    query: URLSearchParams,
  ): Promise<string> {
    const selection = selectGateway(gatewayId);
    if ("error" in selection) {
      return `/portal/payment/result?error=${encodeURIComponent(selection.error)}`;
    }
    const provider = selection.provider;
    const resultUrl = (ref: string, extra = "") =>
      `/portal/payment/result?ref=${encodeURIComponent(ref)}${extra}`;

    // ---- Extract the provider reference from the callback -------------------
    let gatewayRef = "";
    let providerSuccessFlag: boolean | null = null;
    if (provider.id === "zarinpal") {
      gatewayRef = query.get("Authority") ?? query.get("authority") ?? "";
      const status = (query.get("Status") ?? query.get("status") ?? "").toUpperCase();
      providerSuccessFlag = status === "OK" ? true : status === "NOK" ? false : null;
    } else if (provider.id === "zibal") {
      gatewayRef = query.get("trackId") ?? "";
      const success = query.get("success");
      providerSuccessFlag = success === "1" ? true : success === "0" ? false : null;
    }
    if (!gatewayRef) {
      return `/portal/payment/result?error=${encodeURIComponent("پاسخ درگاه پرداخت فاقد شناسه تراکنش است.")}`;
    }

    const tx = await db.transaction.findUnique({
      where: { gatewayRef },
      include: { order: true },
    });
    if (!tx || tx.gateway !== provider.id) {
      return `/portal/payment/result?error=${encodeURIComponent("تراکنش متناظر با پاسخ درگاه یافت نشد.")}`;
    }

    // Idempotent: already finalized — just show the final state.
    if (tx.status !== "pending") {
      return resultUrl(tx.ref);
    }

    // Browser callback parameters are hints, including failure/cancel flags.
    // Verify with the provider before changing any payment state.
    const outcome = await provider.verify({ amountToman: tx.amountToman, gatewayRef });
    if (outcome.ok) {
      await this.finalizeSuccess(tx, {
        gateway: provider.id,
        alreadyVerified: outcome.alreadyVerified,
        raw: outcome.raw,
      });
      return resultUrl(tx.ref);
    }
    if (outcome.reason === "ambiguous") {
      // Keep pending; the result page re-verifies and supports reconciliation.
      await db.transaction.updateMany({
        where: { id: tx.id, status: "pending" },
        data: {
          rawResultJson: JSON.stringify({
            phase: "callback-verify",
            ambiguous: true,
            detail: outcome.detailFa,
            at: new Date().toISOString(),
          }),
        },
      });
      await audit({
        actorLabel: `درگاه ${provider.id}`,
        action: "payment.verification_ambiguous",
        entityType: "transaction",
        entityId: tx.ref,
        meta: { orderNumber: tx.order.orderNumber },
      });
      return resultUrl(tx.ref, "&state=verifying");
    }
    // Verified not-paid / amount mismatch / invalid response: never fulfill.
    const cancelled = outcome.reason === "not_paid" && providerSuccessFlag === false &&
      provider.id === "zibal" && query.get("status") === "2";
    const finalized = await db.transaction.updateMany({
      where: { id: tx.id, status: "pending" },
      data: {
        status: cancelled ? "cancelled" : "failed",
        finalizedAt: new Date(),
        rawResultJson: JSON.stringify({
          phase: "callback-verify",
          reason: cancelled ? "cancelled" : outcome.reason,
          at: new Date().toISOString(),
        }),
      },
    });
    if (finalized.count === 0) return resultUrl(tx.ref);
    await audit({
      actorLabel: `درگاه ${provider.id}`,
      action: cancelled ? "payment.cancelled" : "payment.failed",
      entityType: "transaction",
      entityId: tx.ref,
      meta: { reason: outcome.reason, orderNumber: tx.order.orderNumber },
    });
    return resultUrl(tx.ref);
  },

  /**
   * Re-runs server-side verification for a pending transaction (used by the
   * result page while polling, and for reconciliation). Returns the fresh
   * status. Never fabricates a success state.
   *
   * THROTTLED: the result page polls every few seconds — each poll must NOT
   * hit the provider. A per-ref minimum interval applies, plus a bounded
   * number of verify attempts per ref (after which reconciliation stops and
   * the row stays pending for the operations review). The throttle is
   * ephemeral in-process state; the durable truth is always the transaction
   * record.
   */
  async reverifyPendingTransaction(ref: string): Promise<"pending" | "succeeded" | "failed" | "cancelled"> {
    const tx = await db.transaction.findUnique({ where: { ref }, include: { order: true } });
    if (!tx) throw new HttpError(404, "TX_NOT_FOUND", "تراکنش یافت نشد.");
    if (tx.status !== "pending") return tx.status as "succeeded" | "failed" | "cancelled";

    if (!reverifyThrottle.check(ref)) return "pending";
    const selection = selectGateway(tx.gateway);
    if ("error" in selection || !tx.gatewayRef) {
      // Non-real gateway rows (mock) simply stay pending until their own
      // callback path finalizes them.
      return "pending";
    }
    const provider: PaymentProvider = selection.provider;
    const outcome = await provider.verify({ amountToman: tx.amountToman, gatewayRef: tx.gatewayRef });
    if (outcome.ok) {
      await this.finalizeSuccess(tx, { gateway: provider.id, alreadyVerified: outcome.alreadyVerified, raw: outcome.raw });
      return "succeeded";
    }
    if (outcome.reason === "not_paid" || outcome.reason === "amount_mismatch") {
      // Definitive negative only when the provider explicitly said so during
      // a re-check (amount mismatches stay failed and flagged for review).
      const finalized = await db.transaction.updateMany({
        where: { id: tx.id, status: "pending" },
        data: {
          status: "failed",
          finalizedAt: new Date(),
          rawResultJson: JSON.stringify({ phase: "reverify", reason: outcome.reason, at: new Date().toISOString() }),
        },
      });
      return finalized.count > 0 ? "failed" : "pending";
    }
    return "pending"; // ambiguous — remains pending for reconciliation
  },

  /** Server-rendered gateway page data (validates the URL token). */
  async getTransactionForGateway(ref: string, token: string) {
    if (process.env.NODE_ENV === "production") return null;
    const tx = await db.transaction.findUnique({ where: { ref }, include: { order: true } });
    if (!tx) return null;
    if (tx.status !== "pending") return { tx, order: tx.order, valid: false as const };
    if (sha256(token) !== tx.verifyTokenHash) return null;
    return { tx, order: tx.order, valid: true as const };
  },

  /**
   * The single SUCCESS path for every payment (real gateways and the dev-only
   * mock alike). ATOMIC: transaction, order, invoice, subscriptions and
   * services are written in ONE database transaction guarded by the pending
   * status (idempotent: replayed callbacks are a no-op), so state can never
   * become partially finalized by a crash or a duplicate callback.
   *
   * External side effects (audit trail, notifications, Drive quota changes on
   * the Nextcloud server) run AFTER the commit — they are recoverable and
   * must never sit inside the database transaction.
   */
  async finalizeSuccess(
    tx: Transaction & { order: Order },
    meta: { gateway: string; alreadyVerified?: boolean; raw?: unknown },
  ): Promise<void> {
    if (tx.status === "succeeded") return;
    const now = new Date();

    const fulfilled = await db.$transaction(async (client) => {
      // Conditional final-state write: only ONE racing callback can flip the
      // pending transaction to succeeded; every other caller becomes a no-op.
      const claimed = await client.transaction.updateMany({
        where: { id: tx.id, status: "pending" },
        data: {
          status: "succeeded",
          finalizedAt: now,
          rawResultJson: JSON.stringify({
            gateway: meta.gateway,
            verified: true,
            alreadyVerified: meta.alreadyVerified ?? false,
            result: meta.raw ?? null,
            at: now.toISOString(),
          }),
        },
      });
      if (claimed.count === 0) return false; // already finalized elsewhere

      const orderClaimed = await client.order.updateMany({
        where: { id: tx.orderId, status: "pending_payment" },
        data: { status: "paid", paidAt: now },
      });
      if (orderClaimed.count === 0) return false; // another verified attempt paid this order
      const order = await client.order.findUniqueOrThrow({ where: { id: tx.orderId } });

      await client.invoice.create({
        data: {
          number: randomRef("INV"),
          orderId: order.id,
          userId: order.userId,
          amountToman: order.totalToman,
          status: "paid",
          title: order.invoiceTitle,
          company: order.invoiceCompany,
          paidAt: now,
        },
      });

      await this.fulfill(order, client);
      return true;
    });
    if (!fulfilled) return;

    // ---- Post-commit, recoverable side effects ------------------------------
    const order = await db.order.findUnique({ where: { id: tx.orderId } });
    await audit({
      actorLabel: `درگاه ${meta.gateway} (تأیید سمت سرور)`,
      action: "payment.succeeded",
      entityType: "transaction",
      entityId: tx.ref,
      meta: { orderNumber: tx.order.orderNumber, amountToman: tx.amountToman },
    });
    if (order) await this.postCommitFulfillment(order);
  },

  /**
   * Post-commit fulfillment: customer notifications and the Drive quota
   * application. Every step is individually guarded — a failure here never
   * affects the atomic payment state and is surfaced through notifications.
   */
  async postCommitFulfillment(order: Order): Promise<void> {
    try {
      const user = await db.panelUser.findUnique({ where: { id: order.userId } });
      if (!user) return;
      const invoice = await db.invoice.findFirst({ where: { orderId: order.id } });
      await notificationService.notify(user.id, {
        category: "payment",
        title: "پرداخت با موفقیت تأیید شد",
        body: `پرداخت سفارش ${order.orderNumber} تأیید شد${invoice ? ` و فاکتور ${invoice.number} صادر گردید` : ""}. اشتراک شما فعال شد.`,
        link: "/portal/billing",
      });

      // Apply the entitled Drive quota immediately when a Drive account exists.
      const entitledPlanCode = await getEntitledPlanCode(user.id);
      if (entitledPlanCode) {
        const account = await db.driveAccount.findUnique({ where: { panelUserId: user.id } });
        if (account && account.planCode !== entitledPlanCode) {
          try {
            await driveService.changeQuota(user, entitledPlanCode);
            await notificationService.notify(user.id, {
              category: "drive",
              title: "سهمیه AbrIT Drive به‌روزرسانی شد",
              body: "سهمیه فضای ابری شما مطابق پکیج خریداری‌شده در سرور Drive اعمال شد.",
              link: "/portal/drive",
            });
          } catch (error) {
            console.error("[orders] drive quota application failed:", error);
            await notificationService.notify(user.id, {
              category: "drive",
              title: "اعمال سهمیه Drive ناموفق بود",
              body: "اشتراک شما فعال شد اما اعمال سهمیه جدید روی سرور Drive انجام نشد؛ از صفحه AbrIT Drive همگام‌سازی کنید یا با پشتیبانی تماس بگیرید.",
              link: "/portal/drive",
            });
          }
        } else if (!account) {
          await notificationService.notify(user.id, {
            category: "drive",
            title: "فضای ابری شما آماده فعال‌سازی است",
            body: "با توجه به پکیج خریداری‌شده، می‌توانید حساب AbrIT Drive خود را با سهمیه سازمانی فعال کنید.",
            link: "/portal/drive",
          });
        }
      }
    } catch (error) {
      // Never let post-commit bookkeeping throw — the payment state is already
      // durably correct at this point.
      console.error("[orders] post-commit fulfillment failed:", error);
    }
  },

  /**
   * Legacy finalize for the internal dev/test gateway only (token-based).
   * Real gateways go through handleGatewayCallback + provider verification.
   */
  async finalizePayment(
    ref: string,
    verifyToken: string,
    outcome: "success" | "failure" | "cancel",
  ): Promise<{ status: string; redirectUrl: string }> {
    if (process.env.NODE_ENV === "production") {
      throw new HttpError(403, "MOCK_DISABLED", "درگاه داخلی تست در محیط تولید غیرفعال است.");
    }
    const tx = await db.transaction.findUnique({ where: { ref }, include: { order: true } });
    if (!tx) throw new HttpError(404, "TX_NOT_FOUND", "تراکنش یافت نشد.");
    if (tx.status !== "pending") {
      // Idempotent: already finalized — return the final state.
      return { status: tx.status, redirectUrl: `/portal/payment/result?ref=${ref}` };
    }
    if (!tx.verifyTokenHash || sha256(verifyToken) !== tx.verifyTokenHash) {
      throw new HttpError(403, "INVALID_TOKEN", "پارامترهای پرداخت معتبر نیست.");
    }

    if (outcome === "success") {
      await this.finalizeSuccess(tx, { gateway: "mock", raw: { result: "SUCCESS" } });
    } else {
      const now = new Date();
      await db.transaction.update({
        where: { id: tx.id },
        data: {
          status: outcome === "cancel" ? "cancelled" : "failed",
          finalizedAt: now,
          rawResultJson: JSON.stringify({ gateway: "mock", result: outcome.toUpperCase(), at: now.toISOString() }),
        },
      });
      await audit({
        actorLabel: "درگاه داخلی تست",
        action: `payment.${outcome}`,
        entityType: "transaction",
        entityId: ref,
      });
    }

    return { status: outcome === "success" ? "succeeded" : outcome === "cancel" ? "cancelled" : "failed", redirectUrl: `/portal/payment/result?ref=${ref}` };
  },

  /**
   * Core fulfillment rows (subscriptions + services) — runs INSIDE the
   * finalize transaction so they are atomic with the paid order. The stored
   * `order` may be a pre-transaction row; `client` performs the writes.
   */
  async fulfill(order: Order & { user?: PanelUser }, client?: PrismaTransactionClient): Promise<void> {
    const dbx = client ?? db;
    const items = parseItems(order);
    const now = new Date();

    for (const item of items) {
      const expiresAt = new Date(now);
      expiresAt.setMonth(expiresAt.getMonth() + item.input.months);
      const sub = await dbx.subscription.create({
        data: {
          userId: order.userId,
          orderId: order.id,
          packageCode: item.input.packageCode,
          months: item.input.months,
          users: item.input.users,
          endpoints: item.input.endpoints,
          status: "active",
          startsAt: now,
          expiresAt,
          priceTotalToman: item.totalToman,
          entitlementJson: item.purchasedTerms ? JSON.stringify(item.purchasedTerms) : null,
        },
      });
      await dbx.service.create({
        data: {
          userId: order.userId,
          subscriptionId: sub.id,
          type: "managed_it",
          title: `خدمات مدیریت‌شده — پکیج ${item.packageNameFa}`,
          status: "active",
          activatedAt: now,
          expiresAt,
          metadataJson: JSON.stringify({
            packageCode: item.input.packageCode,
            packageNameFa: item.packageNameFa,
            users: item.input.users,
            endpoints: item.input.endpoints,
          }),
        },
      });
    }
  },

  /** Keeps a Service record in sync when a Drive account is provisioned. */
  async ensureDriveServiceRecord(user: PanelUser, planCode: string, ncUsername: string): Promise<void> {
    const plan = await getPlan(planCode);
    const existing = await db.service.findFirst({ where: { userId: user.id, type: "drive" } });
    const metadataJson = JSON.stringify({
      planCode,
      quotaLabel: plan?.quotaBytes ? `${plan.quotaBytes}` : undefined,
      ncUsername,
    });
    if (existing) {
      await db.service.update({
        where: { id: existing.id },
        data: { status: "active", activatedAt: existing.activatedAt ?? new Date(), metadataJson },
      });
    } else {
      await db.service.create({
        data: {
          userId: user.id,
          type: "drive",
          title: "AbrIT Drive — فضای ابری",
          status: "active",
          activatedAt: new Date(),
          metadataJson,
        },
      });
    }
  },

  /**
   * Payment result for the customer result page. OWNERSHIP ENFORCED: the
   * transaction is returned only to its owner (or an admin-area principal) —
   * another customer's ref is indistinguishable from an unknown ref (404, no
   * existence leak). 8-digit refs alone are never treated as authorization.
   */
  async getPaymentResult(ref: string, requester: PanelUser): Promise<PaymentResultDTO> {
    const tx = await db.transaction.findUnique({
      where: { ref },
      include: { order: { include: { invoices: true } } },
    });
    if (!tx) throw new HttpError(404, "TX_NOT_FOUND", "تراکنش یافت نشد.");
    const isOwner = tx.userId === requester.id;
    const isAdminArea = requester.role === "admin" || requester.role === "staff";
    if (!isOwner && !isAdminArea) {
      // Same response as an unknown ref — no information disclosure.
      throw new HttpError(404, "TX_NOT_FOUND", "تراکنش یافت نشد.");
    }
    const invoice = tx.order.invoices[0] ?? null;
    return {
      ref: tx.ref,
      status: tx.status as PaymentResultDTO["status"],
      gateway: tx.gateway,
      amountToman: tx.amountToman,
      order: tx.order
        ? { id: tx.order.id, orderNumber: tx.order.orderNumber, status: tx.order.status as OrderDTO["status"] }
        : null,
      invoice: invoice ? { id: invoice.id, number: invoice.number } : null,
      finalizedAt: tx.finalizedAt?.toISOString() ?? null,
    };
  },

  async listOrders(userId: string): Promise<OrderListEntryDTO[]> {
    const orders = await db.order.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return orders.map(toOrderListEntry);
  },

  async getOrder(userId: string, id: string): Promise<OrderDTO> {
    const order = await db.order.findFirst({ where: { id, userId } });
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "سفارش یافت نشد.");
    return toOrderDTO(order);
  },

  async cancelOrder(user: PanelUser, id: string): Promise<void> {
    const order = await db.order.findFirst({ where: { id, userId: user.id } });
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "سفارش یافت نشد.");
    if (order.status !== "pending_payment") {
      throw new HttpError(409, "NOT_CANCELLABLE", "فقط سفارش‌های در انتظار پرداخت قابل لغو هستند.");
    }
    await db.order.update({ where: { id: order.id }, data: { status: "cancelled", cancelledAt: new Date() } });
    await db.transaction.updateMany({ where: { orderId: order.id, status: "pending" }, data: { status: "cancelled", finalizedAt: new Date() } });
    await audit({ actor: user, action: "order.cancelled", entityType: "order", entityId: order.id });
  },

  async listInvoices(userId: string): Promise<InvoiceDTO[]> {
    const invoices = await db.invoice.findMany({
      where: { userId },
      orderBy: { issuedAt: "desc" },
      include: { order: true },
    });
    return invoices.map(toInvoiceDTO);
  },

  async getInvoice(userId: string, id: string): Promise<InvoiceDTO> {
    const invoice = await db.invoice.findFirst({ where: { id, userId }, include: { order: true } });
    if (!invoice) throw new HttpError(404, "INVOICE_NOT_FOUND", "فاکتور یافت نشد.");
    return toInvoiceDTO(invoice);
  },

  async listTransactions(userId: string): Promise<TransactionDTO[]> {
    const txs = await db.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { order: true },
    });
    return txs.map(toTransactionDTO);
  },

  async listSubscriptions(userId: string): Promise<SubscriptionDTO[]> {
    const subs = await db.subscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return subs.map(toSubscriptionDTO);
  },

  async listServices(userId: string): Promise<ServiceDTO[]> {
    const services = await db.service.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return services.map(toServiceDTO);
  },

  async getService(userId: string, id: string): Promise<ServiceDTO> {
    const service = await db.service.findFirst({ where: { id, userId } });
    if (!service) throw new HttpError(404, "SERVICE_NOT_FOUND", "سرویس یافت نشد.");
    return toServiceDTO(service);
  },

  /** Aggregate for the portal dashboard (all values are real DB data). */
  async portalDashboard(user: PanelUser): Promise<PortalDashboardDTO> {
    const [services, subs, recentOrders, recentTxs, unread, tickets, drive, entitledPlanCode] = await Promise.all([
      db.service.findMany({ where: { userId: user.id } }),
      getActiveSubscriptions(user.id),
      db.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 5 }),
      db.transaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 5, include: { order: true } }),
      notificationService.unreadCount(user.id),
      db.ticket.findMany({ where: { userId: user.id }, select: { status: true } }),
      driveService.getOverview(user).catch(() => null),
      getEntitledPlanCode(user.id),
    ]);

    const now = Date.now();
    const activeServices = services.filter(
      (s) => s.status === "active" && (!s.expiresAt || s.expiresAt.getTime() > now),
    ).length;
    const bestSub = subs
      .map((s) => {
        try {
          const terms = s.entitlementJson ? JSON.parse(s.entitlementJson) as { planNameFa?: string; driveQuotaBytes?: number } : null;
          return { sub: s, terms };
        } catch { return { sub: s, terms: null }; }
      })
      .filter((x) => Number.isSafeInteger(x.terms?.driveQuotaBytes))
      .sort((a, b) => (b.terms!.driveQuotaBytes! - a.terms!.driveQuotaBytes!))[0];

    return {
      activeServices,
      totalServices: services.length,
      subscription: subs.length
        ? {
            active: true,
            packageNameFa: bestSub?.terms?.planNameFa ?? (bestSub?.sub ?? subs[0]).packageCode,
            expiresAt: (bestSub?.sub ?? subs[0]).expiresAt.toISOString(),
          }
        : null,
      entitledPlanCode,
      recentOrders: recentOrders.map(toOrderListEntry),
      recentTransactions: recentTxs.map(toTransactionDTO),
      drive: {
        state: drive?.state ?? "not_provisioned",
        usedBytes: drive?.usage?.usedBytes ?? null,
        totalBytes: drive?.usage?.totalBytes ?? null,
        planNameFa: drive?.account?.planNameFa ?? null,
      },
      unreadNotifications: unread,
      tickets: {
        open: tickets.filter((t) => t.status === "open").length,
        answered: tickets.filter((t) => t.status === "answered").length,
        total: tickets.length,
      },
    };
  },
};

export {
  toOrderDTO,
  toOrderListEntry,
  toInvoiceDTO,
  toTransactionDTO,
  toSubscriptionDTO,
  toServiceDTO,
  parseItems,
};
export type { OrderItemRow };
