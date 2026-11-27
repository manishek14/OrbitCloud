"use client";

// درباره Orbit — the about page body is CMS-managed (type "page", slug "about");
// value cards are static positioning statements, everything else comes from the API.

import { ArrowLeft, FileText, Headset, Server, ShieldCheck } from "lucide-react";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { usePublicContent } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, LogoMark } from "@/components/abrit/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/abrit/motion";

const VALUE_CARDS = [
  {
    icon: FileText,
    title: "شفافیت تعرفه",
    text: "قیمت‌ها مستقیماً از سند رسمی تعرفه ۱۴۰۵ — پیش‌فاکتور با ریز اقلام، بدون عدد پنهان.",
  },
  {
    icon: ShieldCheck,
    title: "امنیت اول",
    text: "مدیریت Firewall، امنیت Endpoint و پاسخ به رخداد با اولویت‌بندی مطابق SLA.",
  },
  {
    icon: Headset,
    title: "پشتیبانی تعهدشده",
    text: "زمان شروع رسیدگی تیکت‌ها در هر پکیج به‌صورت صریح و تعهدشده اعلام می‌شود.",
  },
  {
    icon: Server,
    title: "زیرساخت سازمانی",
    text: "مانیتورینگ شبکه و سرور، Backup & Recovery و فضای ابری سازمانی Orbit Drive.",
  },
];

export default function AboutView() {
  const router = useRouter();
  const about = usePublicContent("page", "about");
  const page = (about.data ?? [])[0] ?? null;

  return (
    <div>
      {/* ----------------------------------------------------- Hero-lite band */}
      <section className="relative overflow-hidden border-b">
        <div className="bg-grid absolute inset-0" aria-hidden="true" />
        <div
          className="pointer-events-none absolute -top-40 start-1/2 size-[30rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-14 text-center md:px-6 md:py-20">
          <Reveal>
            <LogoMark className="mx-auto size-12" />
            <h1 className="mt-5 text-2xl font-extrabold tracking-tight md:text-4xl">
              درباره Orbit
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
              ارائه‌دهنده خدمات مدیریت‌شده فناوری اطلاعات برای کسب‌وکارهای ایرانی — با تعرفه شفاف و SLA مشخص.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------ About content */}
      <section className="mx-auto max-w-4xl px-4 py-14 md:px-6 md:py-20">
        {about.isLoading ? (
          <div className="rounded-2xl border bg-card p-6 md:p-8">
            <Skeleton className="h-5 w-40" />
            <div className="mt-6 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ) : about.isError ? (
          <ErrorState message="بارگذاری صفحه درباره ما انجام نشد." onRetry={() => about.refetch()} />
        ) : !page ? (
          <EmptyState
            icon={<FileText className="size-6" />}
            title="این صفحه هنوز منتشر نشده است"
            description="محتوای صفحه «درباره Orbit» از پنل مدیریت منتشر می‌شود و به‌زودی در دسترس قرار می‌گیرد."
            action={
              <Button variant="outline" onClick={() => router.navigate(routes.home)} className="gap-2">
                بازگشت به صفحه اصلی
                <ArrowLeft className="size-4" />
              </Button>
            }
          />
        ) : (
          <Reveal>
            <article className="rounded-2xl border bg-card p-6 md:p-8">
              <h2 className="text-lg font-extrabold">{page.title}</h2>
              <div className="mt-4 whitespace-pre-wrap text-sm leading-8 text-foreground/90">
                {page.body}
              </div>
            </article>
          </Reveal>
        )}
      </section>

      {/* -------------------------------------------------------- Value cards */}
      <section className="border-t bg-card/40">
        <div className="mx-auto max-w-7xl px-4 py-14 md:px-6 md:py-20">
          <Reveal>
            <h2 className="text-center text-xl font-extrabold md:text-2xl">ارزش‌های محوری Orbit</h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-7 text-muted-foreground">
              چهار اصلی که طراحی همه پکیج‌ها و فرآیندهای ما بر پایه آن‌ها شکل گرفته است.
            </p>
          </Reveal>
          <Stagger className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {VALUE_CARDS.map((value) => (
              <StaggerItem
                key={value.title}
                className="group rounded-2xl border bg-card p-6 transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg"
              >
                <span className="inline-flex rounded-xl bg-primary/10 p-3 text-primary transition-colors group-hover:bg-primary/15">
                  <value.icon className="size-5" />
                </span>
                <h3 className="mt-4 text-sm font-extrabold">{value.title}</h3>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">{value.text}</p>
              </StaggerItem>
            ))}
          </Stagger>

          <Reveal delay={0.1}>
            <div className="mt-12 text-center">
              <Button size="lg" variant="outline" className="gap-2" onClick={() => router.navigate(routes.contact)}>
                گفت‌وگو با تیم Orbit
                <ArrowLeft className="size-4" />
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
