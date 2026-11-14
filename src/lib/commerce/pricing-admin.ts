import { db } from "@/lib/db";
import { HttpError } from "@/lib/api/http";
import type { CommercialPackage, ContractPolicy } from "./catalog";

type Kind = "plans" | "contracts";
const fail = (message: string) => { throw new HttpError(400, "VALIDATION", message); };
const text = (value: unknown, label: string, required = true) => {
  if (typeof value !== "string" || value.length > 1000 || (required && !value.trim())) fail(`${label} معتبر نیست.`);
  return (value as string).trim();
};
const whole = (value: unknown, label: string, min = 0) => {
  if (!Number.isSafeInteger(value) || (value as number) < min) fail(`${label} باید عدد صحیح معتبر باشد.`);
  return value as number;
};
const rate = (value: unknown, label: string, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) fail(`${label} باید بین صفر و ${max * 100} درصد باشد.`);
  return value as number;
};

export function validatePlan(value: unknown): CommercialPackage {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("اطلاعات پکیج معتبر نیست.");
  const p = value as Record<string, unknown>;
  const code = text(p.code, "شناسه").toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(code)) fail("شناسه پکیج باید انگلیسی و یکتا باشد.");
  const benefitsFa = p.benefitsFa;
  if (!Array.isArray(benefitsFa) || benefitsFa.length > 30 || benefitsFa.some((x) => typeof x !== "string" || x.length > 500)) fail("خدمات پکیج معتبر نیست.");
  if (typeof p.orderable !== "boolean" || typeof p.featured !== "boolean") fail("وضعیت پکیج معتبر نیست.");
  const result: CommercialPackage = {
    code, nameFa: text(p.nameFa, "نام پکیج"), nameEn: text(p.nameEn, "نام انگلیسی"),
    audienceFa: text(p.audienceFa, "مخاطب", false), order: whole(p.order, "ترتیب"),
    monthlyPriceToman: whole(p.monthlyPriceToman, "قیمت ماهانه"), orderable: p.orderable as boolean,
    includedUsers: whole(p.includedUsers, "کاربران شامل"), includedEndpoints: whole(p.includedEndpoints, "Endpoint شامل"),
    includedServers: whole(p.includedServers, "سرور شامل"), includedSites: whole(p.includedSites, "سایت شامل"),
    includedNetworkDevices: whole(p.includedNetworkDevices, "تجهیزات شبکه شامل"),
    driveQuotaBytes: whole(p.driveQuotaBytes, "فضای Drive"),
    extraUserFeeTomanPerMonth: whole(p.extraUserFeeTomanPerMonth, "قیمت کاربر اضافه"),
    extraEndpointFeeTomanPerMonth: whole(p.extraEndpointFeeTomanPerMonth, "قیمت Endpoint اضافه"),
    slaLabelFa: text(p.slaLabelFa, "SLA"), slaDetailFa: text(p.slaDetailFa, "توضیح SLA", false),
    supportHoursFa: text(p.supportHoursFa, "پشتیبانی"), benefitsFa: benefitsFa as string[],
    featured: p.featured as boolean, vpsFa: p.vpsFa === null ? null : text(p.vpsFa, "VPS", false),
    onSiteFa: text(p.onSiteFa, "خدمات حضوری", false),
  };
  if (code === "free" && (result.orderable || result.monthlyPriceToman !== 0))
    fail("پکیج رایگان قابل فروش نیست.");
  if (result.orderable && (result.monthlyPriceToman <= 0 || result.includedUsers < 1 || result.includedEndpoints < 1))
    fail("پکیج قابل خرید باید قیمت و ظرفیت معتبر داشته باشد.");
  return result;
}

export function validateContract(value: unknown): ContractPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("شرایط قرارداد معتبر نیست.");
  const c = value as Record<string, unknown>;
  const months = whole(c.months, "مدت قرارداد", 1);
  if (months > 120) fail("مدت قرارداد حداکثر ۱۲۰ ماه است.");
  return {
    months, discountRate: rate(c.discountRate, "تخفیف", 0.99),
    onboardingRate: rate(c.onboardingRate, "هزینه راه‌اندازی", 1),
    labelFa: text(c.labelFa, "عنوان قرارداد"),
    discountLabelFa: text(c.discountLabelFa, "عنوان تخفیف"),
    onboardingLabelFa: text(c.onboardingLabelFa, "عنوان راه‌اندازی"),
    noteFa: c.noteFa == null ? undefined : text(c.noteFa, "یادداشت", false),
    requiresBusinessApproval: c.requiresBusinessApproval === true,
  };
}

export function revision(value: unknown): number { return whole(value, "نسخه", 1); }

function orderReferences(itemsJson: string, kind: Kind, id: string) {
  try {
    const items = JSON.parse(itemsJson);
    return Array.isArray(items) && items.some((item) => kind === "plans"
      ? item?.input?.packageCode === id
      : Number(item?.input?.months) === Number(id));
  } catch { return true; } // Unknown historical format: refuse physical deletion.
}

export async function createPricing(kind: Kind, payload: unknown) {
  if (kind === "plans") {
    const plan = validatePlan(payload);
    try { return await db.pricingPlan.create({ data: { code: plan.code, payload: JSON.parse(JSON.stringify(plan)) } }); }
    catch (e: any) { if (e?.code === "P2002") throw new HttpError(409, "DUPLICATE", "شناسه پکیج تکراری است."); throw e; }
  }
  const contract = validateContract(payload);
  try { return await db.pricingContract.create({ data: { months: contract.months, payload: JSON.parse(JSON.stringify(contract)) } }); }
  catch (e: any) { if (e?.code === "P2002") throw new HttpError(409, "DUPLICATE", "مدت قرارداد تکراری است."); throw e; }
}

export async function updatePricing(kind: Kind, id: string, expected: number, payload: unknown, active?: boolean) {
  if (kind === "plans") {
    const current = await db.pricingPlan.findUnique({ where: { code: id } });
    if (!current) throw new HttpError(404, "NOT_FOUND", "پکیج یافت نشد.");
    const plan = payload === undefined ? current.payload : validatePlan(payload);
    if ((plan as CommercialPackage).code !== id) fail("شناسه پکیج قابل تغییر نیست.");
    const result = await db.pricingPlan.updateMany({ where: { code: id, revision: expected }, data: { payload: plan as object, active, revision: { increment: 1 } } });
    if (!result.count) throw new HttpError(409, "STALE", "پکیج تغییر کرده است؛ صفحه را تازه‌سازی کنید.");
    return db.pricingPlan.findUniqueOrThrow({ where: { code: id } });
  }
  const months = Number(id);
  if (!Number.isSafeInteger(months)) fail("مدت قرارداد معتبر نیست.");
  const current = await db.pricingContract.findUnique({ where: { months } });
  if (!current) throw new HttpError(404, "NOT_FOUND", "شرایط قرارداد یافت نشد.");
  const contract = payload === undefined ? current.payload : validateContract(payload);
  if ((contract as ContractPolicy).months !== months) fail("مدت قرارداد قابل تغییر نیست.");
  const result = await db.pricingContract.updateMany({ where: { months, revision: expected }, data: { payload: contract as object, active, revision: { increment: 1 } } });
  if (!result.count) throw new HttpError(409, "STALE", "شرایط قرارداد تغییر کرده است؛ صفحه را تازه‌سازی کنید.");
  return db.pricingContract.findUniqueOrThrow({ where: { months } });
}

export async function deletePricing(kind: Kind, id: string, expected: number) {
  return db.$transaction(async (tx) => {
    // Checkout takes SHARE locks on both tables until order creation commits.
    await tx.$executeRawUnsafe('LOCK TABLE "PricingPlan", "PricingContract" IN SHARE ROW EXCLUSIVE MODE');
    const orders = await tx.order.findMany({ select: { itemsJson: true } });
    const referenced = orders.some((o) => orderReferences(o.itemsJson, kind, id));
    if (kind === "plans") {
      if (id === "free") throw new HttpError(409, "PROTECTED", "پکیج رایگان مبنای سهمیه آزمایشی Drive است و قابل حذف نیست.");
      if (referenced || await tx.subscription.count({ where: { packageCode: id } }) ||
        await tx.driveAccount.count({ where: { planCode: id } }) ||
        await tx.cartItem.count({ where: { packageCode: id } }))
        throw new HttpError(409, "REFERENCED", "این پکیج در سفارش، اشتراک یا Drive استفاده شده است؛ آن را غیرفعال کنید.");
      const result = await tx.pricingPlan.deleteMany({ where: { code: id, revision: expected } });
      if (!result.count) throw new HttpError(409, "STALE", "پکیج یافت نشد یا تغییر کرده است؛ صفحه را تازه‌سازی کنید.");
    } else {
      const months = Number(id);
      if (!Number.isSafeInteger(months)) fail("مدت قرارداد معتبر نیست.");
      if (referenced || await tx.subscription.count({ where: { months } }) ||
        await tx.cartItem.count({ where: { months } }))
        throw new HttpError(409, "REFERENCED", "این مدت قرارداد در سفارش یا اشتراک استفاده شده است؛ آن را غیرفعال کنید.");
      const result = await tx.pricingContract.deleteMany({ where: { months, revision: expected } });
      if (!result.count) throw new HttpError(409, "STALE", "شرایط قرارداد یافت نشد یا تغییر کرده است؛ صفحه را تازه‌سازی کنید.");
    }
    return { ok: true };
  });
}
