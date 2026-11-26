"use client";

// Authentication layout — visually independent split screen:
// brand panel (right, RTL start) + form area. Mobile stacks naturally.

import Link from "next/link";
import { ArrowRight, Cloud, Headset, ShieldCheck } from "lucide-react";
import { routes } from "@/lib/routes";
import { Logo } from "@/components/abrit/ui";
import { ThemeSwitcher } from "@/components/abrit/theme-switcher";

const HIGHLIGHTS = [
  { icon: Cloud, title: "فضای ابری Orbit Drive", text: "حساب اختصاصی Nextcloud با سهمیه مطابق پکیج شما" },
  { icon: ShieldCheck, title: "امنیت و شفافیت", text: "پرداخت با تأیید سمت سرور و اسنپ‌شات تغییرناپذیر پیش‌فاکتور" },
  { icon: Headset, title: "پشتیبانی با SLA", text: "مدت قرارداد و سطح خدمات دقیقاً مطابق تعرفه رسمی ۱۴۰۵" },
];

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand panel — hidden on small screens */}
      <aside className="relative hidden w-[42%] flex-col justify-between overflow-hidden border-e bg-[#0B1220] p-10 text-white lg:flex">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
        <div
          className="pointer-events-none absolute -start-32 -top-32 size-96 rounded-full bg-primary/25 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-40 -end-20 size-96 rounded-full bg-[#2563EB]/20 blur-3xl"
          aria-hidden="true"
        />

        <Link href={routes.home} className="relative z-10 inline-flex items-center gap-2.5">
          <Logo className="text-white" textClassName="text-white [&>span:last-child]:text-white/70" />
        </Link>

        <div className="relative z-10 space-y-8">
          <h2 className="max-w-md text-3xl font-extrabold leading-[1.4]">
            زیرساخت IT شما،
            <br />
            <span className="text-gradient">مدیریت‌شده و شفاف</span>
          </h2>
          <ul className="space-y-5">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex items-start gap-3.5">
                <span className="rounded-xl bg-white/10 p-2.5 text-white backdrop-blur">
                  <item.icon className="size-5" />
                </span>
                <div>
                  <p className="text-sm font-bold">{item.title}</p>
                  <p className="mt-0.5 text-xs leading-6 text-white/60">{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-[11px] text-white/50">
          © {new Date().getFullYear()} Orbit — پلتفرم خدمات مدیریت‌شده فناوری اطلاعات
        </p>
      </aside>

      {/* Form area */}
      <main className="relative flex flex-1 flex-col">
        <div className="flex items-center justify-between p-4 md:p-6">
          <Link
            href={routes.home}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowRight className="size-4" />
            بازگشت به سایت
          </Link>
          <ThemeSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </main>
    </div>
  );
}
