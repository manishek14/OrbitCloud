"use client";

// Public marketing website layout: own header/nav/footer, fully separate
// from the portal and admin experiences.

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Link, useIsActive, useRouter } from "@/lib/router";
import { routes, publicNav } from "@/lib/routes";
import { useMe } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Logo, LogoMark } from "@/components/abrit/ui";
import { ThemeSwitcher } from "@/components/abrit/theme-switcher";
import { cn } from "@/lib/utils";

function AuthButtons({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const me = useMe();
  const user = me.data?.user ?? null;
  if (user) {
    return (
      <Button size={compact ? "sm" : "default"} onClick={() => router.navigate(user.role === "customer" ? routes.portal : routes.admin)}>
        ورود به {user.role === "customer" ? "پنل کاربری" : "پنل مدیریت"}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size={compact ? "sm" : "default"} onClick={() => router.navigate(routes.login)}>
        ورود
      </Button>
      <Button size={compact ? "sm" : "default"} onClick={() => router.navigate(routes.register)}>
        ثبت‌نام
      </Button>
    </div>
  );
}

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const isActive = useIsActive();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
          <Link to={routes.home} aria-label="AbrIT — صفحه اصلی" className="shrink-0">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="منوی اصلی سایت">
            {publicNav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors",
                  isActive(item.to, item.to === routes.home)
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                aria-current={isActive(item.to, item.to === routes.home) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden md:block">
              <AuthButtons />
            </div>
            <ThemeSwitcher />
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden rounded-lg" aria-label="باز کردن منو">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 p-0">
                <SheetTitle className="sr-only">منوی سایت AbrIT</SheetTitle>
                <div className="flex h-full flex-col">
                  <div className="flex items-center justify-between border-b p-4">
                    <Logo />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setMobileOpen(false)}
                      aria-label="بستن منو"
                    >
                      <X className="size-5" />
                    </Button>
                  </div>
                  <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="منوی موبایل">
                    {publicNav.map((item) => (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "block rounded-lg px-3.5 py-2.5 text-sm font-semibold transition-colors",
                          isActive(item.to, item.to === routes.home)
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </nav>
                  <div className="border-t p-4">
                    <AuthButtons compact />
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-auto border-t bg-card/60">
        <div className="mx-auto max-w-7xl px-4 py-12 md:px-6">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            <div className="col-span-2 md:col-span-1">
              <Logo />
              <p className="mt-4 max-w-xs text-xs leading-6 text-muted-foreground">
                AbrIT ارائه‌دهنده خدمات مدیریت‌شده فناوری اطلاعات و فضای ابری سازمانی برای کسب‌وکارهای
                ایرانی — با تعرفه رسمی ۱۴۰۵ و SLA مشخص.
              </p>
            </div>
            <div>
              <h3 className="mb-3 text-xs font-extrabold">دسترسی سریع</h3>
              <ul className="space-y-2.5">
                {publicNav.slice(1, 5).map((item) => (
                  <li key={item.to}>
                    <Link to={item.to} className="inline-block py-1 text-xs text-muted-foreground transition-colors hover:text-primary">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-3 text-xs font-extrabold">سرویس‌ها</h3>
              <ul className="space-y-2.5">
                <li><Link to={routes.services} className="inline-block py-1 text-xs text-muted-foreground transition-colors hover:text-primary">مدیریت‌شده IT</Link></li>
                <li><Link to={routes.portalDrive} className="inline-block py-1 text-xs text-muted-foreground transition-colors hover:text-primary">AbrIT Drive</Link></li>
                <li><Link to={routes.plans} className="inline-block py-1 text-xs text-muted-foreground transition-colors hover:text-primary">تعرفه پکیج‌ها</Link></li>
                <li><Link to={routes.faq} className="inline-block py-1 text-xs text-muted-foreground transition-colors hover:text-primary">سوالات متداول</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="mb-3 text-xs font-extrabold">حساب کاربری</h3>
              <ul className="space-y-2.5">
                <li><Link to={routes.login} className="inline-block py-1 text-xs text-muted-foreground transition-colors hover:text-primary">ورود با شماره موبایل</Link></li>
                <li><Link to={routes.register} className="inline-block py-1 text-xs text-muted-foreground transition-colors hover:text-primary">ثبت‌نام</Link></li>
                <li><Link to={routes.portal} className="inline-block py-1 text-xs text-muted-foreground transition-colors hover:text-primary">پنل کاربری</Link></li>
                <li><Link to={routes.contact} className="inline-block py-1 text-xs text-muted-foreground transition-colors hover:text-primary">تماس با فروش</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t pt-6 md:flex-row">
            <p className="text-[11px] text-muted-foreground">
              © {new Date().getFullYear()} AbrIT — کلیه حقوق محفوظ است.
            </p>
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <LogoMark className="size-5" />
              پلتفرم خدمات مدیریت‌شده فناوری اطلاعات
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
