// Plan catalog and Drive quota mapping.
//
// SINGLE SOURCE OF TRUTH: every commercial value (price, capacity, SLA, fees)
// lives in `src/lib/commerce/catalog.ts` — the document-verified 1405 tariffs.
// This module only maps those packages onto Drive tiers (fixes audit COM-12:
// the Orchard repository duplicated commercial values across 9+ sites).
//
// Storage tiers follow «پکیج‌های خدمات مدیریت‌شده فناوری اطلاعات — تعرفه ۱۴۰۵»
// (Orbit_Packages_1405_Final): Essential 10 GB, Standard 25 GB, Professional 50 GB,
// Business 100 GB, Enterprise 250 GB of included cloud storage.
// The "trial" plan implements the initial 100 MB test quota required by the
// Orbit Drive integration guide (سهمیه آزمایشی ۱۰۰ مگابایت).

import { readCommercialCatalog } from "@/lib/commerce/catalog";

export interface DrivePlan {
  code: string;
  nameFa: string;
  nameEn: string;
  quotaBytes: number;
  monthlyPriceToman: number | null;
  featured: boolean;
  audienceFa: string;
  benefitsFa: string[];
}

const TRIAL_PLAN: Omit<DrivePlan, "quotaBytes"> =
  {
    code: "trial",
    nameFa: "آزمایشی",
    nameEn: "Trial",
    monthlyPriceToman: null,
    featured: false,
    audienceFa: "فعال‌سازی اولیه سرویس Drive",
    benefitsFa: [
      "سهمیه آزمایشی برای تست اتصال",
      "ورود مستقیم به Orbit Drive",
      "قابل ارتقا به هر پلن سازمانی",
    ],
  };

export async function getDrivePlans(): Promise<DrivePlan[]> {
  const catalog = await readCommercialCatalog();
  const free = catalog.packages.find((pkg) => pkg.code === "free");
  if (!free) throw new Error("Canonical free plan is missing");
  return [{ ...TRIAL_PLAN, quotaBytes: free.driveQuotaBytes }, ...catalog.packages.filter((pkg) => pkg.orderable && pkg.active).map((pkg) => ({
    code: pkg.code,
    nameFa: pkg.nameFa,
    nameEn: pkg.nameEn,
    quotaBytes: pkg.driveQuotaBytes,
    monthlyPriceToman: pkg.monthlyPriceToman,
    featured: pkg.featured,
    audienceFa: pkg.audienceFa,
    benefitsFa: pkg.benefitsFa,
  }))];
}

export async function getPlan(code: string): Promise<DrivePlan | undefined> {
  const catalog = await readCommercialCatalog();
  if (code === "trial") {
    const free = catalog.packages.find((p) => p.code === "free");
    if (!free) throw new Error("Canonical free plan is missing");
    return { ...TRIAL_PLAN, quotaBytes: free.driveQuotaBytes };
  }
  const pkg = catalog.packages.find((p) => p.code === code);
  return pkg ? {
    code: pkg.code, nameFa: pkg.nameFa, nameEn: pkg.nameEn,
    quotaBytes: pkg.driveQuotaBytes, monthlyPriceToman: pkg.monthlyPriceToman,
    featured: pkg.featured, audienceFa: pkg.audienceFa, benefitsFa: pkg.benefitsFa,
  } : undefined;
}

export async function planLabel(code: string): Promise<string> {
  const plan = await getPlan(code);
  return plan ? plan.nameFa : code;
}

/** "100 MB" / "10 GB" — the documented quota format accepted by Nextcloud. */
export function toHumanQuota(bytes: number): string {
  if (bytes <= 0) return "none";
  const units: Array<[number, string]> = [
    [1024 ** 4, "TB"],
    [1024 ** 3, "GB"],
    [1024 ** 2, "MB"],
    [1024, "KB"],
  ];
  for (const [factor, unit] of units) {
    if (bytes >= factor) {
      const value = bytes / factor;
      const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1);
      return `${rounded} ${unit}`;
    }
  }
  return `${bytes} B`;
}
