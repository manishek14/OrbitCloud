"use client";

// Public homepage — Orbit as a technology & managed-IT provider. Content is
// real: services & FAQ come from the CMS (managed in the admin), pricing
// preview from the authoritative catalog API.

import {
  ArrowLeft,
  Check,
  Cloud,
  Cpu,
  Headset,
  Layers,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useCommerceCatalog, usePublicContent, useMe } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { LogoMark, SkeletonCards } from "@/components/abrit/ui";
import { PriceCard, SectionTitle } from "@/components/abrit/price";
import { Reveal, Stagger, StaggerItem } from "@/components/abrit/motion";
import { AnimatedContent } from "@/components/abrit/motion";

const STEPS = [
  { icon: Layers, title: "انتخاب پکیج", text: "پکیج متناسب با تعداد کاربر و Endpoint خود را از تعرفه رسمی ۱۴۰۵ انتخاب کنید." },
  { icon: ShieldCheck, title: "قرارداد شفاف", text: "پیش‌فاکتور دقیق با ریز اقلام، تخفیف مدت قرارداد و هزینه Onboarding — بدون عدد پنهان." },
  { icon: Cloud, title: "تحویل سرویس", text: "بلافاصله پس از تأیید پرداخت، اشتراک فعال و حساب فضای ابری Orbit Drive شما ساخته می‌شود." },
  { icon: Headset, title: "پشتیبانی با SLA", text: "تیکت‌ها از پنل پیگیری می‌شوند؛ زمان شروع رسیدگی مطابق SLA پکیج شما تضمین شده است." },
];

const TRUST_POINTS = [
  { icon: ShieldCheck, title: "امنیت سازمانی", text: "مدیریت Firewall، امنیت Endpoint و پاسخ به رخداد با اولویت‌بندی SLA" },
  { icon: Cpu, title: "زیرساخت مدیریت‌شده", text: "مانیتورینگ شبکه و سرور، Backup & Recovery با پایش دوره‌ای" },
  { icon: Cloud, title: "فضای ابری اختصاصی", text: "Orbit Drive بر پایه Nextcloud با سهمیه ۱۰ تا ۲۵۰ گیگابایت" },
  { icon: TrendingUp, title: "گزارش‌پذیری", text: "پنل مشتری با سفارش‌ها، فاکتورها و وضعیت لحظه‌ای سرویس‌ها" },
];

export default function HomeView() {
  const router = useRouter();
  const me = useMe();
  const catalog = useCommerceCatalog();
  const services = usePublicContent("service");
  const faqs = usePublicContent("faq");
  const user = me.data?.user ?? null;

  const featuredPackages = (catalog.data?.packages ?? []).slice(0, 3);
  const topFaqs = (faqs.data ?? []).slice(0, 4);
  const topServices = (services.data ?? []).slice(0, 4);

  return (
    <AnimatedContent>
      {/* ---------------------------------------------------------------- Hero */}
      <section className="relative overflow-hidden border-b">
        <div className="bg-grid absolute inset-0" aria-hidden="true" />
        <div
          className="pointer-events-none absolute -top-40 start-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-20 text-center md:px-6 md:py-28">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary">
              <Sparkles className="size-3.5" />
              تعرفه رسمی ۱۴۰۵ — پکیج‌های خدمات مدیریت‌شده فناوری اطلاعات
            </span>
          </Reveal>
          <Reveal delay={0.08}>
            <h1 className="mx-auto mt-6 max-w-3xl text-3xl font-extrabold leading-[1.35] tracking-tight md:text-5xl md:leading-[1.3]">
              زیرساخت IT کسب‌وکار شما
              <br />
              <span className="text-gradient">مدیریت‌شده، امن و شفاف</span>
            </h1>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base md:leading-8">
              Orbit کل زیرساخت فناوری اطلاعات سازمان شما — از مانیتورینگ شبکه و امنیت تا فضای ابری
              سازمانی — را با قراردادهای ۱ تا ۶ ماهه، SLA مشخص و تعرفه شفاف مدیریت می‌کند.
            </p>
          </Reveal>
          <Reveal delay={0.24}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" className="gap-2" onClick={() => router.navigate(routes.plans)}>
                مشاهده پلن‌ها و تعرفه
                <ArrowLeft className="size-4" />
              </Button>
              {user ? (
                <Button size="lg" variant="outline" onClick={() => router.navigate(user.role === "customer" ? routes.portal : routes.admin)}>
                  ورود به پنل کاربری
                </Button>
              ) : (
                <Button size="lg" variant="outline" onClick={() => router.navigate(routes.register)}>
                  ساخت حساب کاربری
                </Button>
              )}
            </div>
          </Reveal>
          <Reveal delay={0.32}>
            <div className="mx-auto mt-10 flex max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11px] font-semibold text-muted-foreground">
              <span className="flex items-center gap-1.5"><Check className="size-3.5 text-success" /> قرارداد ۱ تا ۶ ماهه</span>
              <span className="flex items-center gap-1.5"><Check className="size-3.5 text-success" /> پیش‌فاکتور با ریز اقلام</span>
              <span className="flex items-center gap-1.5"><Check className="size-3.5 text-success" /> فضای ابری Nextcloud</span>
              <span className="flex items-center gap-1.5"><Check className="size-3.5 text-success" /> SLA شروع رسیدگی</span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------ Services */}
      <section className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-24">
        <SectionTitle
          eyebrow="خدمات Orbit"
          title="همه آنچه زیرساخت IT شما نیاز دارد"
          description="از مدیریت شبکه و امنیت تا فضای ابری و پشتیبانی — به‌صورت پکیج‌های یکپارچه."
        />
        {services.isLoading ? (
          <SkeletonCards count={4} />
        ) : (
          <Stagger className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {(topServices.length > 0 ? topServices : FALLBACK_SERVICES).map((service, i) => (
              <StaggerItem key={service.slug} className="group rounded-2xl border bg-card p-6 transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg">
                <span className="inline-flex rounded-xl bg-primary/10 p-3 text-primary">
                  {[<Layers key="0" className="size-5" />, <Cloud key="1" className="size-5" />, <ShieldCheck key="2" className="size-5" />, <Headset key="3" className="size-5" />][i % 4]}
                </span>
                <h3 className="mt-4 text-sm font-extrabold">{service.title}</h3>
                <p className="mt-2 text-xs leading-6 text-muted-foreground line-clamp-3">
                  {service.excerpt ?? service.body.slice(0, 120)}
                </p>
                <Link
                  to={routes.services}
                  className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-bold text-primary transition-colors hover:text-primary/80"
                >
                  بیشتر بدانید
                  <ArrowLeft className="size-3" />
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </section>

      {/* -------------------------------------------------------------- Trust */}
      <section className="border-y bg-card/40">
        <div className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-20">
          <SectionTitle
            eyebrow="چرا Orbit"
            title="مدیریت‌شده یعنی قابل‌اتکا و قابل‌اندازه‌گیری"
          />
          <Stagger className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_POINTS.map((point) => (
              <StaggerItem key={point.title} className="rounded-2xl border bg-card p-5">
                <span className="inline-flex rounded-lg bg-success/10 p-2.5 text-success">
                  <point.icon className="size-5" />
                </span>
                <h3 className="mt-3.5 text-sm font-extrabold">{point.title}</h3>
                <p className="mt-1.5 text-xs leading-6 text-muted-foreground">{point.text}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ------------------------------------------------------------ Pricing */}
      <section className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-24">
        <SectionTitle
          eyebrow="تعرفه ۱۴۰۵"
          title="پکیج‌های خدمات مدیریت‌شده"
          description="قیمت‌ها از سند رسمی پکیج‌های ۱۴۰۵ — پیش‌فاکتور شما با ریز اقلام، همان‌جا در پنل محاسبه می‌شود."
          action={
            <Button variant="outline" size="sm" onClick={() => router.navigate(routes.plans)}>
              مقایسه کامل پکیج‌ها
              <ArrowLeft className="size-4" />
            </Button>
          }
        />
        {catalog.isLoading ? (
          <SkeletonCards count={3} />
        ) : (
          <Stagger className="grid grid-cols-1 items-stretch gap-6 pt-4 md:grid-cols-3">
            {featuredPackages.map((pkg) => (
              <StaggerItem key={pkg.code} className="h-full">
                <PriceCard
                  pkg={pkg}
                  ctaLabel="شروع سفارش"
                  onSelect={() => {
                    if (!user) {
                      toast.info("برای سفارش ابتدا وارد حساب کاربری شوید.");
                      router.navigate(`${routes.login}?next=${encodeURIComponent(routes.portalPlan(pkg.code))}`);
                      return;
                    }
                    router.navigate(routes.portalPlan(pkg.code));
                  }}
                />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </section>

      {/* --------------------------------------------------------- How it works */}
      <section className="border-y bg-card/40">
        <div className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-20">
          <SectionTitle eyebrow="فرآیند همکاری" title="از انتخاب پکیج تا پشتیبانی، در چهار قدم" />
          <Stagger className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <StaggerItem key={step.title} className="relative rounded-2xl border bg-card p-6">
                <span className="absolute end-5 top-5 text-3xl font-extrabold text-primary/10">
                  {"۱۲۳۴"[i]}
                </span>
                <span className="inline-flex rounded-xl bg-primary/10 p-3 text-primary">
                  <step.icon className="size-5" />
                </span>
                <h3 className="mt-4 text-sm font-extrabold">{step.title}</h3>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">{step.text}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ---------------------------------------------------------------- FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-16 md:px-6 md:py-24">
        <SectionTitle eyebrow="سوالات متداول" title="پاسخ سوال‌های پرتکرار" />
        {faqs.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-card" />
            ))}
          </div>
        ) : (
          <Reveal>
            <Accordion type="single" collapsible className="space-y-3">
              {topFaqs.map((faq) => (
                <AccordionItem key={faq.id} value={faq.id} className="rounded-xl border bg-card px-5 data-[state=open]:border-primary/40">
                  <AccordionTrigger className="py-4 text-sm font-bold hover:no-underline">
                    {faq.title}
                  </AccordionTrigger>
                  <AccordionContent className="pb-4 text-xs leading-7 text-muted-foreground">
                    {faq.body}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>
        )}
        <div className="mt-6 text-center">
          <Link to={routes.faq} className="text-xs font-bold text-primary hover:text-primary/80">
            مشاهده همه سوالات متداول →
          </Link>
        </div>
      </section>

      {/* ------------------------------------------------------------- CTA band */}
      <section className="border-t bg-[#0B1220] text-white dark:bg-[#0B1220]">
        <div className="relative mx-auto max-w-7xl overflow-hidden px-4 py-16 text-center md:px-6 md:py-20">
          <div className="bg-grid pointer-events-none absolute inset-0 opacity-30" aria-hidden="true" />
          <div className="relative">
            <LogoMark className="mx-auto size-14" />
            <h2 className="mx-auto mt-5 max-w-2xl text-2xl font-extrabold md:text-3xl">
              آماده‌اید زیرساخت IT خود را به Orbit بسپارید؟
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-white/60">
              همین حالا حساب بسازید، پکیج مناسب را انتخاب کنید و پیش‌فاکتور دقیق را در پنل ببینید.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" className="gap-2" onClick={() => router.navigate(routes.register)}>
                شروع کنید
                <ArrowLeft className="size-4" />
              </Button>
              <Button size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => router.navigate(routes.contact)}>
                مشاوره و تماس با فروش
              </Button>
            </div>
          </div>
        </div>
      </section>
    </AnimatedContent>
  );
}

// Fallback when no service content is published yet (honest empty state).
const FALLBACK_SERVICES = [
  { id: "s1", slug: "managed-it", title: "خدمات مدیریت‌شده فناوری اطلاعات", excerpt: "مانیتورینگ، امنیت و مدیریت کامل زیرساخت با SLA مشخص.", body: "" },
  { id: "s2", slug: "orbit-drive", title: "Orbit Drive — فضای ابری سازمانی", excerpt: "حساب اختصاصی Nextcloud با همگام‌سازی و اشتراک‌گذاری امن.", body: "" },
  { id: "s3", slug: "security", title: "امنیت شبکه و Endpoint", excerpt: "Firewall Management و امنیت دستگاه‌ها با پاسخ به رخداد.", body: "" },
  { id: "s4", slug: "support", title: "پشتیبانی و Help Desk", excerpt: "ثبت و پیگیری تیکت با اولویت‌بندی مطابق SLA پکیج.", body: "" },
] as const;
