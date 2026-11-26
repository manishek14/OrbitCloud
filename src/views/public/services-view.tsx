"use client";

// خدمات Orbit — full list of managed-IT services published from the admin CMS.
// Every card is real CMS content; loading/error/empty states are honest.

import { ArrowLeft, Cloud, Headset, Layers, ShieldCheck } from "lucide-react";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { usePublicContent } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SkeletonCards } from "@/components/abrit/ui";
import { SectionTitle } from "@/components/abrit/price";
import { Reveal, Stagger, StaggerItem } from "@/components/abrit/motion";
import type { ContentItemDTO } from "@/lib/api/types";

const SERVICE_ICONS = [Layers, Cloud, ShieldCheck, Headset];

export default function ServicesView() {
  const router = useRouter();
  const services = usePublicContent("service");
  const items: ContentItemDTO[] = services.data ?? [];

  return (
    <div>
      {/* ---------------------------------------------------------- Hero band */}
      <section className="relative overflow-hidden border-b">
        <div
          className="pointer-events-none absolute -top-40 start-1/2 size-[30rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-14 text-center md:px-6 md:py-20">
          <Reveal>
            <SectionTitle
              eyebrow="خدمات Orbit"
              title="خدمات مدیریت‌شده فناوری اطلاعات"
              description="زیرساخت IT سازمان شما — از مانیتورینگ و امنیت تا فضای ابری و Help Desk — به‌صورت یکپارچه و با SLA مشخص مدیریت می‌شود."
            />
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------- Services grid */}
      <section className="mx-auto max-w-7xl px-4 py-14 md:px-6 md:py-20">
        {services.isLoading ? (
          <SkeletonCards count={4} />
        ) : services.isError ? (
          <ErrorState
            message="بارگذاری خدمات انجام نشد."
            onRetry={() => services.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Layers className="size-6" />}
            title="هنوز خدمتی منتشر نشده است"
            description="فهرست خدمات به‌زودی تکمیل می‌شود؛ در همین حین می‌توانید پکیج‌ها و تعرفه رسمی ۱۴۰۵ را بررسی کنید."
            action={
              <Button onClick={() => router.navigate(routes.plans)} className="gap-2">
                مشاهده پکیج‌ها و تعرفه
                <ArrowLeft className="size-4" />
              </Button>
            }
          />
        ) : (
          <Stagger className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((service, i) => {
              const Icon = SERVICE_ICONS[i % SERVICE_ICONS.length];
              return (
                <StaggerItem
                  key={service.id}
                  className="group flex flex-col rounded-2xl border bg-card p-6 transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg"
                >
                  <span className="inline-flex w-fit rounded-xl bg-primary/10 p-3 text-primary transition-colors group-hover:bg-primary/15">
                    <Icon className="size-5" />
                  </span>
                  <h2 className="mt-4 text-sm font-extrabold">{service.title}</h2>
                  {service.excerpt ? (
                    <p className="mt-2 text-xs font-medium leading-6 text-primary/90">{service.excerpt}</p>
                  ) : null}
                  <p className="mt-2 flex-1 text-xs leading-6 text-muted-foreground line-clamp-4">
                    {service.body}
                  </p>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </section>

      {/* ---------------------------------------------------------- CTA band */}
      <section className="border-t bg-card/40">
        <div className="mx-auto max-w-7xl px-4 py-14 text-center md:px-6 md:py-18">
          <Reveal>
            <h2 className="text-xl font-extrabold md:text-2xl">
              برای هر یک از این خدمات، پکیج متناسب کسب‌وکارتان را انتخاب کنید
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
              تعرفه‌ها از سند رسمی پکیج‌های ۱۴۰۵ محاسبه می‌شوند؛ پیش‌فاکتور دقیق با ریز اقلام در پنل مشتری صادر می‌شود.
            </p>
            <Button size="lg" className="mt-6 gap-2" onClick={() => router.navigate(routes.plans)}>
              انتخاب پکیج مناسب
              <ArrowLeft className="size-4" />
            </Button>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
