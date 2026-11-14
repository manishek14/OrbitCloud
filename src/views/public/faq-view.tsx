"use client";

// سوالات متداول — CMS-managed FAQ list with client-side search over
// title + body, plus escalation CTAs (contact form / portal ticketing).

import { useMemo, useState } from "react";
import { CircleHelp, MessageCircleQuestion, TicketCheck } from "lucide-react";
import { useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { usePublicContent } from "@/lib/api/hooks";
import { toEnDigits, toFaDigits } from "@/lib/format/fa";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { EmptyState, ErrorState, SearchInput } from "@/components/abrit/ui";
import { Reveal } from "@/components/abrit/motion";

export default function FaqView() {
  const router = useRouter();
  const faqs = usePublicContent("faq");
  const [query, setQuery] = useState("");

  const items = faqs.data ?? [];

  const normalize = (value: string) => toEnDigits(value.trim().toLowerCase());

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return items;
    return items.filter(
      (faq) => normalize(faq.title).includes(q) || normalize(faq.body).includes(q),
    );
  }, [items, query]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 md:px-6 md:py-20">
      {/* ---------------------------------------------------------- Page head */}
      <Reveal>
        <div className="text-center">
          <span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">
            سوالات متداول
          </span>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight md:text-3xl">
            پاسخ سوال‌های پرتکرار
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
            پاسخ سوال‌های خود درباره پکیج‌ها، قراردادها، پرداخت و پشتیبانی را اینجا پیدا کنید.
          </p>
        </div>
      </Reveal>

      {/* --------------------------------------------------------- Search box */}
      <Reveal delay={0.06}>
        <div className="mt-8 space-y-3">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
            placeholder="جست‌وجو در سوالات… مثال: قرارداد، فضای ابری، پرداخت"
            aria-label="جست‌وجو در سوالات متداول"
          />
          {query.trim() && !faqs.isLoading && !faqs.isError ? (
            <p className="text-[11px] text-muted-foreground">
              {filtered.length > 0
                ? `${toFaDigits(filtered.length)} سوال یافت شد`
                : "نتیجه‌ای برای این عبارت پیدا نشد."}
            </p>
          ) : null}
        </div>
      </Reveal>

      {/* ------------------------------------------------------------ FAQ list */}
      <div className="mt-6">
        {faqs.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-card" />
            ))}
          </div>
        ) : faqs.isError ? (
          <ErrorState message="بارگذاری سوالات متداول انجام نشد." onRetry={() => faqs.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<MessageCircleQuestion className="size-6" />}
            title="هنوز سوالی منتشر نشده است"
            description="فهرست سوالات متداول از پنل مدیریت تکمیل می‌شود؛ سوال خود را از طریق فرم تماس بپرسید."
            action={
              <Button variant="outline" onClick={() => router.navigate(routes.contact)}>
                تماس با ما
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<CircleHelp className="size-6" />}
            title="نتیجه‌ای یافت نشد"
            description="عبارت دیگری را جست‌وجو کنید یا مستقیم با تیم AbrIT تماس بگیرید."
            action={
              <Button variant="outline" onClick={() => setQuery("")}>
                پاک کردن جست‌وجو
              </Button>
            }
          />
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <span className="rounded-full border bg-card px-3 py-1 text-[11px] font-bold text-muted-foreground">
                {toFaDigits(filtered.length)} سوال
              </span>
            </div>
            <Reveal>
              <Accordion type="single" collapsible className="space-y-3">
                {filtered.map((faq) => (
                  <AccordionItem
                    key={faq.id}
                    value={faq.id}
                    className="rounded-xl border bg-card px-5 data-[state=open]:border-primary/40"
                  >
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
          </>
        )}
      </div>

      {/* ------------------------------------------------------------ CTA row */}
      <Reveal delay={0.1}>
        <div className="mt-10 rounded-2xl border bg-card p-6 text-center">
          <h2 className="text-sm font-extrabold">پاسخ سوال خود را پیدا نکردید؟</h2>
          <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
            تیم فروش و پشتیبانی AbrIT در ساعات کاری پاسخگوی شماست.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Button onClick={() => router.navigate(routes.contact)} className="gap-2">
              تماس با ما
            </Button>
            <Button variant="outline" onClick={() => router.navigate(routes.login)} className="gap-2">
              <TicketCheck className="size-4" />
              ثبت تیکت در پنل
            </Button>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
