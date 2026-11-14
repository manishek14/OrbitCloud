// ============================================================================
// Initial approved catalog values for migrations and local pricing tests.
// PostgreSQL PricingPlan/PricingContract are the runtime source of truth.
//
// Every value below is taken verbatim from the final business document
// «پکیج‌های خدمات مدیریت‌شده فناوری اطلاعات — تعرفه ۱۴۰۵»
// (Abrit_Packages_1405_Final). No price, capacity, SLA, fee or discount may be
// duplicated anywhere else in the codebase (fixes audit finding COM-12: the
// Orchard repository duplicated commercial values across 9+ sites, which
// produced the divergent prices/SLA/durations shipped there).
//
// Fixes vs. the audited Orchard implementation:
//   COM-01: Professional/Business/Enterprise monthly prices corrected
//           (32,900,000 / 52,900,000 / 79,900,000 — not 29.5M/45.9M/66.9M).
//   COM-02: user counts corrected to 5/10/15/25/40 (not 4/7/10/20/30).
//   COM-03: extra-user monthly fees present (were zero).
//   COM-04: endpoint capacity + extra-endpoint fees present (were absent).
//   COM-05: SLA commitments (see the 1405 SLA amendment below).
//   COM-06: contract periods are exactly 1, 3 and 6 months (the previous
//           12-month option was REMOVED by the latest business decision).
//   COM-07: the 1-month contract is a new, explicitly configurable option
//           with NO discount and NO onboarding fee (no commercial value was
//           invented — ⚠ PENDING FINAL BUSINESS APPROVAL, see
//           ONE_MONTH_POLICY below).
//   COM-08: onboarding fees seeded (50% / 25%) for the approved 3/6-month
//           contracts.
//
// 1405 SLA amendment (supersedes previous SLA values everywhere):
//   پایه ۸ ساعت · استاندارد ۵ ساعت · حرفه‌ای ۳ ساعت · سازمانی ۱ ساعت ·
//   سازمانی پلاس لحظه‌ای. SLA always means the agreed START of incident
//   handling — never a guaranteed full-resolution time.
// ============================================================================

import { db } from "@/lib/db";

export interface CommercialPackage {
  /** Stable code used by APIs and the Drive quota mapping. */
  code: string;
  nameFa: string;
  nameEn: string;
  /** Short audience line (from the document, per package). */
  audienceFa: string;
  order: number;
  monthlyPriceToman: number;
  /** Free plan is not purchasable — activation happens through AbrIT Drive. */
  orderable: boolean;
  includedUsers: number;
  includedEndpoints: number;
  /** Managed servers/VMs included (0 = «بدون Server مدیریت‌شده در سهمیه»). */
  includedServers: number;
  includedSites: number;
  /** Managed network devices included (Cisco/MikroTik etc.). */
  includedNetworkDevices: number;
  /** Included AbrIT Drive (Nextcloud) cloud storage, bytes. */
  driveQuotaBytes: number;
  extraUserFeeTomanPerMonth: number;
  extraEndpointFeeTomanPerMonth: number;
  /** SLA label + detail, verbatim from the document. */
  slaLabelFa: string;
  slaDetailFa: string;
  supportHoursFa: string;
  /** Top service bullets for the catalog cards (verbatim, abbreviated). */
  benefitsFa: string[];
  /** «پیشنهاد AbrIT» — the document marks Professional as the recommended tier. */
  featured: boolean;
  vpsFa: string | null;
  onSiteFa: string;
}

export interface ContractPolicy {
  months: number;
  /** 0 / 0.03 / 0.05 — applied to the BASE monthly price only. */
  discountRate: number;
  /** 0 / 0.5 / 0.25 — of ONE month's base package price (excludes extra users). */
  onboardingRate: number;
  labelFa: string;
  discountLabelFa: string;
  onboardingLabelFa: string;
  /** True while the policy still requires final business sign-off. */
  requiresBusinessApproval?: boolean;
  noteFa?: string;
}

const GB = 1024 ** 3;

export const COMMERCIAL_PACKAGES: CommercialPackage[] = [
  {
    // The FREE plan — explicitly required by the product specification.
    // Honest semantics: it covers the panel account and the 100 MB AbrIT
    // Drive trial quota ONLY — no managed-IT services are included, so no
    // users/endpoints/servers/SLA values are claimed (they render as «—»).
    // It is NOT purchasable: activation happens from the AbrIT Drive page.
    code: "free",
    nameFa: "رایگان",
    nameEn: "Free",
    audienceFa: "شروع رایگان — حساب پنل و ۱۰۰ مگابایت فضای ابری AbrIT Drive",
    order: 0,
    monthlyPriceToman: 0,
    orderable: false,
    includedUsers: 0,
    includedEndpoints: 0,
    includedServers: 0,
    includedSites: 0,
    includedNetworkDevices: 0,
    driveQuotaBytes: 100 * 1024 * 1024, // 100 MB — the documented trial quota
    extraUserFeeTomanPerMonth: 0,
    extraEndpointFeeTomanPerMonth: 0,
    slaLabelFa: "—",
    slaDetailFa: "پلن رایگان فاقد SLA خدمات مدیریت‌شده است.",
    supportHoursFa: "—",
    benefitsFa: [
      "۱۰۰ مگابایت فضای ابری AbrIT Drive (Nextcloud)",
      "حساب کاربری پنل مشتریان AbrIT",
      "ثبت و پیگیری تیکت پشتیبانی",
      "قابل ارتقا به هر پکیج مدیریت‌شده در هر زمان",
    ],
    featured: false,
    vpsFa: null,
    onSiteFa: "—",
  },
  {
    code: "essential",
    nameFa: "پایه",
    nameEn: "Essential",
    audienceFa: "برای شرکت‌های کوچک و استارتاپ‌ها",
    order: 1,
    monthlyPriceToman: 12_950_000,
    orderable: true,
    includedUsers: 5,
    includedEndpoints: 6,
    includedServers: 0,
    includedSites: 1,
    includedNetworkDevices: 0,
    driveQuotaBytes: 10 * GB,
    extraUserFeeTomanPerMonth: 1_590_000,
    extraEndpointFeeTomanPerMonth: 790_000,
    slaLabelFa: "حداکثر ۸ ساعت کاری",
    slaDetailFa: "SLA شروع رسیدگی (نه تضمین رفع): حداکثر ۸ ساعت کاری",
    supportHoursFa: "۸×۵ در روزهای کاری",
    benefitsFa: [
      "Firewall Management پایه",
      "Endpoint Security / Antivirus",
      "Help Desk از راه دور",
      "RMM پایه و مانیتورینگ پایه شبکه",
    ],
    featured: false,
    vpsFa: null,
    onSiteFa: "خارج از پکیج و با تعرفه جداگانه",
  },
  {
    code: "standard",
    nameFa: "استاندارد",
    nameEn: "Standard",
    audienceFa: "برای شرکت‌های کوچک تا متوسط با مدیریت متمرکز کاربران",
    order: 2,
    monthlyPriceToman: 19_500_000,
    orderable: true,
    includedUsers: 10,
    includedEndpoints: 12,
    includedServers: 1,
    includedSites: 1,
    includedNetworkDevices: 0,
    driveQuotaBytes: 25 * GB,
    extraUserFeeTomanPerMonth: 1_990_000,
    extraEndpointFeeTomanPerMonth: 990_000,
    slaLabelFa: "حداکثر ۵ ساعت کاری",
    slaDetailFa: "SLA شروع رسیدگی (نه تضمین رفع): حداکثر ۵ ساعت کاری",
    supportHoursFa: "۸×۵",
    benefitsFa: [
      "تمام خدمات پکیج پایه",
      "Active Directory و فضای ابری ۲۵ گیگابایتی",
      "Backup Management پایه",
      "مدیریت یک Server/VM",
    ],
    featured: false,
    vpsFa: null,
    onSiteFa: "با تعرفه جداگانه",
  },
  {
    code: "professional",
    nameFa: "حرفه‌ای",
    nameEn: "Professional",
    audienceFa: "پیشنهاد AbrIT — برای شرکت‌های در حال رشد و چندسرویسی",
    order: 3,
    monthlyPriceToman: 32_900_000,
    orderable: true,
    includedUsers: 15,
    includedEndpoints: 20,
    includedServers: 2,
    includedSites: 2,
    includedNetworkDevices: 4,
    driveQuotaBytes: 50 * GB,
    extraUserFeeTomanPerMonth: 2_690_000,
    extraEndpointFeeTomanPerMonth: 1_290_000,
    slaLabelFa: "حداکثر ۳ ساعت کاری",
    slaDetailFa: "SLA شروع رسیدگی (نه تضمین رفع): حداکثر ۳ ساعت کاری",
    supportHoursFa: "۸×۵ با اولویت بالاتر",
    benefitsFa: [
      "تمام خدمات پکیج استاندارد",
      "Site-to-Site VPN و VoIP/Issabel",
      "مانیتورینگ پیشرفته شبکه و Server",
      "فضای ابری AbrIT تا ۵۰ گیگابایت",
    ],
    featured: true,
    vpsFa: null,
    onSiteFa: "حسب نیاز و با تعرفه جداگانه",
  },
  {
    code: "business",
    nameFa: "سازمانی",
    nameEn: "Business",
    audienceFa: "برای سازمان‌های متوسط با چند سرور، شبکه پیشرفته و نیاز به حضور دوره‌ای",
    order: 4,
    monthlyPriceToman: 52_900_000,
    orderable: true,
    includedUsers: 25,
    includedEndpoints: 35,
    includedServers: 4,
    includedSites: 3,
    includedNetworkDevices: 8,
    driveQuotaBytes: 100 * GB,
    extraUserFeeTomanPerMonth: 3_790_000,
    extraEndpointFeeTomanPerMonth: 1_790_000,
    slaLabelFa: "حداکثر ۱ ساعت کاری",
    slaDetailFa: "SLA شروع رسیدگی عادی: حداکثر ۱ ساعت کاری؛ P1 خارج ساعات اداری: کانال اضطراری توافق‌شده",
    supportHoursFa: "۸×۵ + رسیدگی اضطراری P1",
    benefitsFa: [
      "تمام خدمات پکیج حرفه‌ای",
      "مدیریت پیشرفته شبکه و Firewall",
      "Backup & Recovery با پایش روزانه",
      "یک VPS ابری AbrIT + حضور ماهانه در مشهد",
    ],
    featured: false,
    vpsFa: "یک VPS ابری AbrIT: تا ۲ vCPU، ۴ GB RAM، ۸۰ GB Disk",
    onSiteFa: "یک نوبت برنامه‌ریزی‌شده در ماه (مشهد؛ حداکثر نیم‌روز کاری)",
  },
  {
    code: "enterprise",
    nameFa: "سازمانی پلاس",
    nameEn: "Enterprise",
    audienceFa: "بالاترین سطح استاندارد برای سازمان‌های حساس و چندسایتی",
    order: 5,
    monthlyPriceToman: 79_900_000,
    orderable: true,
    includedUsers: 40,
    includedEndpoints: 60,
    includedServers: 8,
    includedSites: 5,
    includedNetworkDevices: 12,
    driveQuotaBytes: 250 * GB,
    extraUserFeeTomanPerMonth: 4_990_000,
    extraEndpointFeeTomanPerMonth: 2_490_000,
    slaLabelFa: "لحظه‌ای",
    slaDetailFa: "SLA لحظه‌ای (P1): شروع رسیدگی بلافاصله پس از ثبت رخداد P1 در پوشش ۲۴×۷؛ تیکت‌های عادی در ساعات کاری",
    supportHoursFa: "۲۴×۷ فقط برای رخدادهای P1",
    benefitsFa: [
      "Managed IT جامع و ۲۴×۷ برای رخدادهای P1",
      "مدیریت تا ۱۲ تجهیز شبکه و ۵ Site/Branch",
      "فضای ابری AbrIT تا ۲۵۰ گیگابایت",
      "دو VPS ابری + گزارش مدیریتی ماهانه",
    ],
    featured: false,
    vpsFa: "دو VPS ابری AbrIT؛ مجموعاً تا ۸ vCPU، ۱۶ GB RAM، ۲۰۰ GB Disk",
    onSiteFa: "یک نوبت برنامه‌ریزی‌شده در هفته (مشهد؛ حداکثر نیم‌روز)",
  },
];

// ---------------------------------------------------------------------------
// 1-month contract — explicit configuration. No discount and no onboarding
// fee were invented for this new period: both are 0 and clearly flagged as
// PENDING FINAL BUSINESS APPROVAL. Change these two values (and remove the
// approval flag) once the business confirms the 1-month commercial terms.
// ---------------------------------------------------------------------------
export const ONE_MONTH_POLICY = {
  discountRate: 0,
  onboardingRate: 0,
  requiresBusinessApproval: true,
} as const;

/** Configurable definition of «لحظه‌ای» for سازمانی پلاس (Enterprise Plus). */
export const SLA_IMMEDIATE_DEFINITION_FA =
  "«لحظه‌ای» یعنی شروع رسیدگی رخداد P1 بلافاصله پس از ثبت تیکت در پوشش ۲۴×۷ انجام می‌شود و به‌معنای تضمین زمان رفع کامل نیست.";

export const CONTRACT_POLICIES: ContractPolicy[] = [
  {
    months: 1,
    discountRate: ONE_MONTH_POLICY.discountRate,
    onboardingRate: ONE_MONTH_POLICY.onboardingRate,
    labelFa: "۱ ماهه",
    discountLabelFa: "بدون تخفیف",
    onboardingLabelFa: "بدون هزینه Onboarding",
    requiresBusinessApproval: ONE_MONTH_POLICY.requiresBusinessApproval,
    noteFa: "قرارداد یک‌ماهه فاقد تخفیف و هزینه Onboarding است (در انتظار تأیید نهایی شرایط تجاری).",
  },
  {
    months: 3,
    discountRate: 0.03,
    onboardingRate: 0.5,
    labelFa: "۳ ماهه",
    discountLabelFa: "۳٪ تخفیف",
    onboardingLabelFa: "Onboarding: ۵۰٪ قیمت یک ماه پکیج",
  },
  {
    months: 6,
    discountRate: 0.05,
    onboardingRate: 0.25,
    labelFa: "۶ ماهه",
    discountLabelFa: "۵٪ تخفیف",
    onboardingLabelFa: "Onboarding: ۲۵٪ قیمت یک ماه پکیج",
  },
];

/**
 * Global quote bounds from the document («برای بیش از ۴۰ User/۶۰ Endpoint:
 * Enterprise Custom — قیمت پس از Assessment اولیه»). Requests beyond these
 * totals are not priceable from the standard catalog and require a custom
 * assessment; the quote API returns needsCustomAssessment instead of a number.
 */
export const QUOTE_LIMITS = {
  maxQuotableUsers: 40,
  maxQuotableEndpoints: 60,
} as const;

export const COMMERCE_POLICY_FA = {
  prepaid:
    "قراردادهای AbrIT به‌صورت پیش‌پرداخت هستند و در سه مدت ۱، ۳ و ۶ ماهه ارائه می‌شوند؛ تخفیف مدت فقط برای قراردادهای ۳ و ۶ ماهه اعمال می‌شود.",
  minimumMonths: 1,
  allowedMonths: [1, 3, 6] as const,
  discountScope:
    "تخفیف مدت قرارداد فقط روی قیمت پایه ماهانه پکیج اعمال می‌شود؛ کاربر و Endpoint اضافه با قیمت کامل محاسبه می‌شوند.",
  onboardingScope:
    "هزینه Onboarding درصدی از قیمت پایه یک ماهِ همان پکیج است و کاربران اضافه را در بر نمی‌گیرد.",
  customAssessment:
    "برای بیش از ۴۰ کاربر یا ۶۰ Endpoint، پکیج «Enterprise Custom» پس از Assessment اولیه به‌صورت جداگانه برآورد می‌شود.",
  slaNote:
    "SLA زمان شروع رسیدگی است، نه تضمین زمان رفع کامل Incident. تعریف «لحظه‌ای» برای پکیج سازمانی پلاس: شروع رسیدگی بلافاصله پس از ثبت رخداد P1 در پوشش ۲۴×۷.",
  checkoutNote:
    "خرید آنلاین از پنل مشتریان فعال است؛ مبلغ نهایی همیشه سمت سرور از موتور قیمت‌گذاری رسمی بازمحاسبه و در اسنپ‌شات تغییرناپذیر ثبت می‌شود. درگاه‌های پرداخت این محیط در حالت Sandbox (آزمایشی) زرین‌پال و زیبال هستند.",
} as const;

// Runtime reads fail closed. The constants above are migration seed material only.
export async function readCommercialCatalog() {
  const [planRows, contractRows] = await Promise.all([
    db.pricingPlan.findMany({ orderBy: { code: "asc" } }),
    db.pricingContract.findMany({ orderBy: { months: "asc" } }),
  ]);
  if (!planRows.length || !contractRows.length) throw new Error("Canonical pricing catalog is not seeded");
  for (const row of planRows) {
    const p = row.payload as unknown as CommercialPackage;
    if (p.code !== row.code || !p.nameFa ||
      ![p.monthlyPriceToman, p.includedUsers, p.includedEndpoints,
        p.driveQuotaBytes, p.extraUserFeeTomanPerMonth,
        p.extraEndpointFeeTomanPerMonth].every((n) => Number.isSafeInteger(n) && n >= 0)) {
      throw new Error(`Invalid canonical plan: ${row.code}`);
    }
  }
  for (const row of contractRows) {
    const c = row.payload as unknown as ContractPolicy;
    if (c.months !== row.months || !Number.isSafeInteger(c.months) || c.months < 1 ||
      !Number.isFinite(c.discountRate) || c.discountRate < 0 || c.discountRate >= 1 ||
      !Number.isFinite(c.onboardingRate) || c.onboardingRate < 0 || c.onboardingRate > 1) {
      throw new Error(`Invalid canonical contract: ${row.months}`);
    }
  }
  return {
    packages: planRows.map((row) => ({ ...(row.payload as unknown as CommercialPackage), active: row.active, revision: row.revision })),
    contracts: contractRows.map((row) => ({ ...(row.payload as unknown as ContractPolicy), active: row.active, revision: row.revision })),
  };
}
