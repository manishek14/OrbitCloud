// ============================================================================
// Quote engine — server-side pricing with immutable snapshots.
//
// Policy (from the 1405 packages document + the latest contract/SLA
// amendment — supersedes the earlier 3/6/12-month policy):
//   • Contract durations: 1 month (no discount, no onboarding fee — explicitly
//     configurable, pending final business approval), 3 months (3% discount),
//     6 months (5% discount). The 12-month option was REMOVED.
//   • The duration discount applies to the BASE monthly package price only.
//   • Extra users / extra endpoints are charged at full price per month.
//   • Onboarding = rate × ONE month's base package price (excludes extra users):
//     3mo→50%, 6mo→25%, 1mo→0 (no fee invented for the new period).
//   • Beyond 40 users or 60 endpoints total: Enterprise Custom assessment
//     (needsCustomAssessment) — never an invented number.
//   • All amounts are whole Toman integers.
//
// Every quote returns an immutable snapshot (quoteId + checksum). The checksum
// is the SHA-256 of a canonical JSON serialization, so the order flow persists
// the snapshot and verifies it was not tampered with. Quote completeness is
// separate from checkout authorization.
// ============================================================================

import { createHash, randomUUID } from "node:crypto";
import {
  QUOTE_LIMITS,
  readCommercialCatalog,
} from "./catalog";

export interface QuoteInput {
  packageCode: string;
  months: number;
  users: number;
  endpoints: number;
}

export interface QuoteLineItem {
  key: string;
  labelFa: string;
  amountToman: number;
  noteFa?: string;
}

export interface QuoteBreakdown {
  packageCode: string;
  packageNameFa: string;
  months: number;
  users: number;
  endpoints: number;
  monthlyBaseToman: number;
  baseSubtotalToman: number;
  discountRate: number;
  discountToman: number;
  baseAfterDiscountToman: number;
  extraUsers: number;
  extraUserFeePerMonthToman: number;
  extraUsersTotalToman: number;
  extraEndpoints: number;
  extraEndpointFeePerMonthToman: number;
  extraEndpointsTotalToman: number;
  onboardingRate: number;
  onboardingToman: number;
  totalToman: number;
  perMonthEquivalentToman: number;
}

export interface QuoteSnapshot {
  version: 1;
  quoteId: string;
  createdAt: string;
  packageCode: string;
  months: number;
  users: number;
  endpoints: number;
  totalToman: number;
  checksum: string;
}

export interface QuoteResult {
  valid: boolean;
  errors: string[];
  needsCustomAssessment: boolean;
  breakdown: QuoteBreakdown | null;
  lineItems: QuoteLineItem[];
  snapshot: QuoteSnapshot | null;
  /** Checkout is wired to the order flow (server-side recalculation + immutable snapshots). */
  checkoutEnabled: boolean;
  purchasedTerms?: {
    planCode: string; planNameFa: string; driveQuotaBytes: number; includedUsers: number;
    includedEndpoints: number; users: number; endpoints: number;
    months: number; discountRate: number; onboardingRate: number;
    slaLabelFa: string; slaDetailFa: string; supportHoursFa: string;
    benefitsFa: string[]; monthlyPriceToman: number;
    plan: import("./catalog").CommercialPackage;
    contract: import("./catalog").ContractPolicy;
  };
}

/** Canonical JSON: object keys sorted recursively, arrays kept in order. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => JSON.stringify(k) + ":" + canonicalize(v));
  return "{" + entries.join(",") + "}";
}

function snapshotChecksum(payload: Omit<QuoteSnapshot, "checksum">): string {
  return createHash("sha256").update(canonicalize(payload), "utf8").digest("hex");
}

function toWholeToman(value: number): number {
  return Math.round(value);
}

export async function computeQuote(input: QuoteInput): Promise<QuoteResult> {
  return calculateQuote(input, await readCommercialCatalog());
}

export function calculateQuote(input: QuoteInput, catalog: Awaited<ReturnType<typeof readCommercialCatalog>>): QuoteResult {
  const errors: string[] = [];
  const pkg = catalog.packages.find((p) => p.code === String(input.packageCode ?? "").trim().toLowerCase());
  if (!pkg) {
    errors.push("پکیج انتخابی معتبر نیست.");
  } else if (!pkg.orderable || !pkg.active) {
    // The free plan is an activation (Orbit Drive), never a purchase.
    return {
      valid: false,
      errors: ["پلن رایگان نیازی به خرید ندارد؛ فضای ابری ۱۰۰ مگابایتی از صفحه Orbit Drive فعال می‌شود."],
      needsCustomAssessment: false,
      breakdown: null,
      lineItems: [],
      snapshot: null,
      checkoutEnabled: false,
    };
  }

  const months = Number(input.months);
  const policy = catalog.contracts.find((p) => p.months === months && p.active);
  if (!policy) {
    errors.push("مدت قرارداد انتخابی فعال یا معتبر نیست.");
  }

  const users = Number(input.users);
  if (!Number.isInteger(users) || users < 1) {
    errors.push("تعداد کاربر باید عددی صحیح و حداقل ۱ باشد.");
  }

  const endpoints = Number(input.endpoints);
  if (!Number.isInteger(endpoints) || endpoints < 1) {
    errors.push("تعداد Endpoint باید عددی صحیح و حداقل ۱ باشد.");
  }

  const needsCustomAssessment =
    Number.isInteger(users) && Number.isInteger(endpoints) &&
    (users > QUOTE_LIMITS.maxQuotableUsers || endpoints > QUOTE_LIMITS.maxQuotableEndpoints);
  if (Number.isInteger(users) && users > QUOTE_LIMITS.maxQuotableUsers) {
    errors.push(
      `برای بیش از ${QUOTE_LIMITS.maxQuotableUsers} کاربر، پکیج «Enterprise Custom» پس از Assessment اولیه به‌صورت جداگانه برآورد می‌شود.`,
    );
  }
  if (Number.isInteger(endpoints) && endpoints > QUOTE_LIMITS.maxQuotableEndpoints) {
    errors.push(
      `برای بیش از ${QUOTE_LIMITS.maxQuotableEndpoints} Endpoint، پکیج «Enterprise Custom» پس از Assessment اولیه به‌صورت جداگانه برآورد می‌شود.`,
    );
  }

  if (errors.length > 0 || !pkg || !policy) {
    return { valid: false, errors, needsCustomAssessment, breakdown: null, lineItems: [], snapshot: null, checkoutEnabled: false };
  }
  // ---- computation (whole Toman integers only) ------------------------------
  const monthlyBase = pkg.monthlyPriceToman;
  const baseSubtotal = monthlyBase * policy.months;
  const discount = toWholeToman(baseSubtotal * policy.discountRate);
  const baseAfterDiscount = baseSubtotal - discount;

  const extraUsers = Math.max(0, users - pkg.includedUsers);
  const extraUsersTotal = extraUsers * pkg.extraUserFeeTomanPerMonth * policy.months;

  const extraEndpoints = Math.max(0, endpoints - pkg.includedEndpoints);
  const extraEndpointsTotal = extraEndpoints * pkg.extraEndpointFeeTomanPerMonth * policy.months;

  const onboarding = toWholeToman(monthlyBase * policy.onboardingRate);

  const total = baseAfterDiscount + extraUsersTotal + extraEndpointsTotal + onboarding;
  if (![baseSubtotal, discount, extraUsersTotal, extraEndpointsTotal, onboarding, total].every(Number.isSafeInteger)) {
    throw new Error("Canonical pricing exceeds safe integer Toman bounds");
  }
  const perMonthEquivalent = toWholeToman(total / policy.months);

  const breakdown: QuoteBreakdown = {
    packageCode: pkg.code,
    packageNameFa: pkg.nameFa,
    months: policy.months,
    users,
    endpoints,
    monthlyBaseToman: monthlyBase,
    baseSubtotalToman: baseSubtotal,
    discountRate: policy.discountRate,
    discountToman: discount,
    baseAfterDiscountToman: baseAfterDiscount,
    extraUsers,
    extraUserFeePerMonthToman: pkg.extraUserFeeTomanPerMonth,
    extraUsersTotalToman: extraUsersTotal,
    extraEndpoints,
    extraEndpointFeePerMonthToman: pkg.extraEndpointFeeTomanPerMonth,
    extraEndpointsTotalToman: extraEndpointsTotal,
    onboardingRate: policy.onboardingRate,
    onboardingToman: onboarding,
    totalToman: total,
    perMonthEquivalentToman: perMonthEquivalent,
  };

  const lineItems: QuoteLineItem[] = [
    {
      key: "base",
      labelFa: `قیمت پایه ${pkg.nameFa} — ${policy.months} ماه`,
      amountToman: baseSubtotal,
      noteFa: `${pkg.monthlyPriceToman.toLocaleString("en-US")} تومان × ${policy.months} ماه`,
    },
    {
      key: "discount",
      labelFa: `تخفیف قرارداد ${policy.labelFa}`,
      amountToman: -discount,
      noteFa: `${(policy.discountRate * 100).toFixed(0)}٪ روی قیمت پایه (فقط قیمت پایه؛ شامل ظرفیت اضافه نیست)`,
    },
    {
      key: "extra_users",
      labelFa: "کاربر اضافه",
      amountToman: extraUsersTotal,
      noteFa:
        extraUsers > 0
          ? `${extraUsers} کاربر × ${pkg.extraUserFeeTomanPerMonth.toLocaleString("en-US")} تومان × ${policy.months} ماه`
          : "داخل سهمیه پکیج",
    },
    {
      key: "extra_endpoints",
      labelFa: "Endpoint اضافه",
      amountToman: extraEndpointsTotal,
      noteFa:
        extraEndpoints > 0
          ? `${extraEndpoints} دستگاه × ${pkg.extraEndpointFeeTomanPerMonth.toLocaleString("en-US")} تومان × ${policy.months} ماه`
          : "داخل سهمیه پکیج",
    },
    {
      key: "onboarding",
      labelFa: "هزینه Onboarding (یک‌بار)",
      amountToman: onboarding,
      noteFa:
        policy.onboardingRate > 0
          ? `${(policy.onboardingRate * 100).toFixed(0)}٪ قیمت یک ماه پایه — بدون احتساب کاربران اضافه`
          : policy.months === 1
            ? "قرارداد یک‌ماهه فاقد هزینه Onboarding است"
            : "بدون هزینه Onboarding",
    },
  ];

  const quoteId = randomUUID();
  const createdAt = new Date().toISOString();
  const snapshotPayload: Omit<QuoteSnapshot, "checksum"> = {
    version: 1,
    quoteId,
    createdAt,
    packageCode: pkg.code,
    months: policy.months,
    users,
    endpoints,
    totalToman: total,
  };
  const snapshot: QuoteSnapshot = {
    ...snapshotPayload,
    checksum: snapshotChecksum(snapshotPayload),
  };

  return { valid: true, errors: [], needsCustomAssessment, breakdown, lineItems, snapshot, checkoutEnabled: true,
    purchasedTerms: {
      planCode: pkg.code, planNameFa: pkg.nameFa, driveQuotaBytes: pkg.driveQuotaBytes,
      includedUsers: pkg.includedUsers, includedEndpoints: pkg.includedEndpoints,
      users, endpoints, months: policy.months, discountRate: policy.discountRate,
      onboardingRate: policy.onboardingRate, slaLabelFa: pkg.slaLabelFa,
      slaDetailFa: pkg.slaDetailFa, supportHoursFa: pkg.supportHoursFa,
      benefitsFa: pkg.benefitsFa, monthlyPriceToman: pkg.monthlyPriceToman,
      plan: { ...pkg }, contract: { ...policy },
    } };
}

/** Re-computes a snapshot checksum for later order-flow verification. */
export function verifySnapshotSnapshotChecksum(snapshot: {
  version: 1;
  quoteId: string;
  createdAt: string;
  packageCode: string;
  months: number;
  users: number;
  endpoints: number;
  totalToman: number;
  checksum: string;
}): boolean {
  const { checksum, ...payload } = snapshot;
  return snapshotChecksum(payload) === checksum;
}
