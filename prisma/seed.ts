// Seed: admin + demo customer accounts, public-site content (FAQ/services/about)
// and contact settings. Idempotent — safe to re-run.
// Usage: bun prisma/seed.ts

import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function main() {
  // --- accounts -------------------------------------------------------------
  const admin = await db.panelUser.upsert({
    where: { email: "admin@abrit.ir" },
    update: { role: "admin", status: "active" },
    create: {
      email: "admin@abrit.ir",
      mobile: "09120000000",
      name: "مدیر AbrIT",
      passwordHash: hashPassword("AbrIT@Admin1405"),
      role: "admin",
      status: "active",
    },
  });
  await db.panelUser.upsert({
    where: { email: "demo@abrit.ir" },
    update: { role: "customer", status: "active" },
    create: {
      email: "demo@abrit.ir",
      mobile: "09121111111",
      name: "کاربر نمایشی AbrIT",
      passwordHash: hashPassword("AbrIT@Demo1405"),
      role: "customer",
      status: "active",
    },
  });
  console.log(`seed: admin ready (${admin.email})`);

  // --- FAQ content ------------------------------------------------------------
  const faqs: Array<{ slug: string; title: string; body: string; order: number }> = [
    {
      slug: "faq-min-contract",
      title: "قراردادهای AbrIT حداقل چندماهه است؟",
      body: "همه قراردادهای AbrIT حداقل سه‌ماهه و به‌صورت پیش‌پرداخت هستند. مدت‌های انتخابی ۳ ماهه (۳٪ تخفیف)، ۶ ماهه (۵٪ تخفیف) و ۱۲ ماهه (۸٪ تخفیف + Onboarding رایگان) هستند.",
      order: 1,
    },
    {
      slug: "faq-one-month",
      title: "آیا قرارداد یک‌ماهه وجود دارد؟",
      body: "خیر. قرارداد یک‌ماهه در هیچ پکیج و شرایطی ارائه نمی‌شود؛ کمترین دوره قرارداد ۳ ماه است.",
      order: 2,
    },
    {
      slug: "faq-drive-quota",
      title: "سهمیه فضای ابری (AbrIT Drive) هر پکیج چقدر است؟",
      body: "پکیج پایه ۱۰ گیگابایت، استاندارد ۲۵ گیگابایت، حرفه‌ای ۵۰ گیگابایت، سازمانی ۱۰۰ گیگابایت و سازمانی پلاس ۲۵۰ گیگابایت فضای ابری دارد. سهمیه پلن آزمایشی Drive نیز ۱۰۰ مگابایت است.",
      order: 3,
    },
    {
      slug: "faq-sla",
      title: "SLA در قرارداد به چه معناست؟",
      body: "SLA در تعرفه ۱۴۰۵ زمان «شروع رسیدگی» است، نه تضمین رفع کامل رخداد. برای مثال پکیج پایه حداکثر ۸ ساعت کاری و پکیج سازمانی پلاس برای رخداد P1 حداکثر ۳۰ دقیقه زمان شروع رسیدگی دارد.",
      order: 4,
    },
    {
      slug: "faq-drive-activate",
      title: "چطور سرویس فضای ابری AbrIT Drive را فعال کنم؟",
      body: "پس از ورود به پنل کاربری، از بخش «AbrIT Drive» یک نام کاربری و رمز عبور برای حساب Drive خود انتخاب کنید. حساب به‌صورت خودکار در سرور Drive ساخته شده و سهمیه مطابق پلن شما اعمال می‌شود. ورود به Drive از نشانی drive.abrit.cloud با همین نام کاربری انجام می‌شود.",
      order: 5,
    },
    {
      slug: "faq-custom-size",
      title: "اگر به بیش از ۴۰ کاربر یا ۶۰ Endpoint نیاز داشته باشم چه کنم؟",
      body: "برای ظرفیت‌های بزرگ‌تر، پکیج «Enterprise Custom» پس از Assessment اولیه به‌صورت جداگانه برآورد می‌شود. از صفحه تماس با ما درخواست خود را ثبت کنید تا کارشناسان AbrIT با شما تماس بگیرند.",
      order: 6,
    },
  ];
  for (const f of faqs) {
    await db.contentItem.upsert({
      where: { slug: f.slug },
      update: { title: f.title, body: f.body, sortOrder: f.order, status: "published" },
      create: {
        type: "faq",
        slug: f.slug,
        title: f.title,
        body: f.body,
        sortOrder: f.order,
        status: "published",
        publishedAt: new Date(),
      },
    });
  }

  // --- Services content -------------------------------------------------------
  const services: Array<{ slug: string; title: string; excerpt: string; body: string; order: number }> = [
    {
      slug: "service-managed-it",
      title: "خدمات مدیریت‌شده فناوری اطلاعات",
      excerpt: "برون‌سپاری کامل مدیریت IT با پشتیبانی تعریف‌شده در SLA",
      body: "پکیج‌های خدمات مدیریت‌شده AbrIT پوشش کامل زیرساخت شما را ارائه می‌کند: مانیتورینگ و مدیریت شبکه، امنیت Endpoint و Firewall، مدیریت سرور و ماشین‌های مجازی، پشتیبان‌گیری و بازیابی، و Help Desk با SLA شروع رسیدگی مشخص — از ۸ ساعت کاری در پکیج پایه تا ۳۰ دقیقه برای رخدادهای P1 در پکیج سازمانی پلاس.",
      order: 1,
    },
    {
      slug: "service-abrit-drive",
      title: "AbrIT Drive — فضای ابری سازمانی",
      excerpt: "فضای ابری اختصاصی بر پایه Nextcloud با همگام‌سازی و اشتراک‌گذاری امن",
      body: "AbrIT Drive روی بستر Nextcloud ارائه می‌شود؛ هر مشتری یک حساب کاربری اختصاصی با سهمیه مطابق پکیج خود دریافت می‌کند (از ۱۰ گیگابایت در پکیج پایه تا ۲۵۰ گیگابایت در سازمانی پلاس). همگام‌سازی فایل بین دستگاه‌ها، اشتراک‌گذاری امن با لینک، نسخه‌بندی فایل‌ها و دسترسی از وب و موبایل از امکانات اصلی این سرویس است.",
      order: 2,
    },
    {
      slug: "service-security",
      title: "امنیت شبکه و Endpoint",
      excerpt: "Firewall Management، آنتی‌ویروس مدیریت‌شده و پاسخ به رخداد",
      body: "مدیریت و پایش مستمر Firewall، استقرار و مدیریت مرکزی امنیت Endpoint و آنتی‌ویروس، به‌روزرسانی و وصله‌کردن سازمان‌یافته و اولویت‌بندی رخدادهای امنیتی مطابق SLA پکیج شما. در پکیج‌های حرفه‌ای به بالا، مانیتورینگ پیشرفته شبکه و سرور نیز فعال می‌شود.",
      order: 3,
    },
    {
      slug: "service-support",
      title: "پشتیبانی و Help Desk",
      excerpt: "پشتیبانی از راه دور و حضور در محل (مشهد) طبق پلن",
      body: "ثبت و پیگیری تیکت از پنل کاربری، پشتیبانی تلفنی و از راه دور در ساعات کاری (۸×۵)، کانال اضطراری P1 در پکیج‌های سازمانی، و حضور برنامه‌ریزی‌شده کارشناس در محل (مشهد) — از یک نوبت ماهانه در پکیج سازمانی تا هفتگی در پکیج سازمانی پلاس.",
      order: 4,
    },
  ];
  for (const s of services) {
    await db.contentItem.upsert({
      where: { slug: s.slug },
      update: { title: s.title, excerpt: s.excerpt, body: s.body, sortOrder: s.order, status: "published" },
      create: {
        type: "service",
        slug: s.slug,
        title: s.title,
        excerpt: s.excerpt,
        body: s.body,
        sortOrder: s.order,
        status: "published",
        publishedAt: new Date(),
      },
    });
  }

  // --- About page ---------------------------------------------------------------
  await db.contentItem.upsert({
    where: { slug: "about" },
    update: {},
    create: {
      type: "page",
      slug: "about",
      title: "درباره AbrIT",
      excerpt: " AbrIT — ارائه‌دهنده خدمات مدیریت‌شده فناوری اطلاعات",
      body: "AbrIT با تمرکز بر کسب‌وکارهای ایرانی، خدمات مدیریت‌شده فناوری اطلاعات را با تعرفه شفاف و SLA مشخص ارائه می‌کند. ما زیرساخت شبکه، امنیت، سرورها و فضای ابری سازمانی شما را مدیریت می‌کنیم تا تیم شما روی کسب‌وکار تمرکز کند.\n\nپکیج‌های AbrIT بر پایه سند «پکیج‌های خدمات مدیریت‌شده فناوری اطلاعات — تعرفه ۱۴۰۵» طراحی شده‌اند: از پکیج پایه برای تیم‌های کوچک تا سازمانی پلاس برای سازمان‌های چندسایتی و حساس. همه قیمت‌ها، ظرفیت‌ها و تعهدات سطح خدمات در این سند رسمی مستند است و پیش‌فاکتور دقیق شما از همان منبع محاسبه می‌شود.\n\nتمرکز ما بر مشهد است؛ حضور در محل در پکیج‌های سازمانی گنجانده شده و برای سایر شهرها خدمات از راه دور ارائه می‌شود.",
      status: "published",
      sortOrder: 1,
      publishedAt: new Date(),
    },
  });

  // --- Contact settings (editable from the admin Settings page) ---------------
  const settings: Record<string, string> = {
    contact_phone: "051-38000000",
    contact_mobile: "09120000000",
    contact_email: "info@abrit.ir",
    contact_address: "مشهد، ایران",
    contact_hours: "شنبه تا چهارشنبه ۸ تا ۱۷ — پنجشنبه ۸ تا ۱۳",
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  console.log("seed: content + settings ready");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
