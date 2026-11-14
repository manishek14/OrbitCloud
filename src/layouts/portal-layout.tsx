"use client";

// Customer portal layout — persistent RIGHT-side navigation (RTL start side),
// sticky top header with notifications + user menu, breadcrumb-ready content
// area, and a responsive drawer on mobile. Requires an authenticated user.

import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Boxes,
  Cloud,
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Package,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  User,
  X,
} from "lucide-react";
import { Link, useIsActive, useRouter } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useLogout, useMe, useNotifications, useMarkNotificationsRead, useCart } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Logo, FullPageLoader, StatusBadge } from "@/components/abrit/ui";
import { ThemeSwitcher } from "@/components/abrit/theme-switcher";
import { AnimatedContent } from "@/components/abrit/motion";
import { formatRelative } from "@/lib/format/fa";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: "notifications" | "cart";
}

interface NavGroup {
  title?: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    items: [{ to: routes.portal, label: "داشبورد", icon: LayoutDashboard }],
  },
  {
    items: [{ to: routes.portalServices, label: "سرویس‌های من", icon: Boxes }],
  },
  {
    title: "خرید و اشتراک",
    items: [
      { to: routes.portalPlans, label: "پلن‌ها و تعرفه", icon: Package },
      { to: routes.portalCart, label: "سبد خرید", icon: ShoppingCart, badge: "cart" },
      { to: routes.portalOrders, label: "سفارش‌ها", icon: Receipt },
      { to: routes.portalBilling, label: "پرداخت‌ها و فاکتورها", icon: CreditCard },
    ],
  },
  {
    items: [{ to: routes.portalDrive, label: "AbrIT Drive", icon: Cloud }],
  },
  {
    items: [
      { to: routes.portalTickets, label: "پشتیبانی و تیکت‌ها", icon: LifeBuoy },
      { to: routes.portalNotifications, label: "اعلان‌ها", icon: Bell, badge: "notifications" },
    ],
  },
  {
    title: "حساب کاربری",
    items: [
      { to: routes.portalProfile, label: "پروفایل", icon: User },
      { to: routes.portalSecurity, label: "امنیت", icon: ShieldCheck },
      { to: "/portal/settings", label: "تنظیمات", icon: Settings },
    ],
  },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const isActive = useIsActive();
  const me = useMe();
  const cart = useCart();
  const user = me.data?.user ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <Link to={routes.portal} onClick={onNavigate}>
          <Logo />
        </Link>
      </div>

      {user ? (
        <div className="border-b px-4 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-sm font-extrabold text-primary">
              {(user.name ?? user.email).slice(0, 2)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold">{user.name ?? "کاربر AbrIT"}</p>
              <p className="truncate text-[10px] text-muted-foreground" dir="ltr">
                {user.email}
              </p>
            </div>
          </div>
          {user.role !== "customer" ? (
            <a
              href={routes.admin}
              className="mt-3 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] font-bold text-primary transition-colors hover:bg-primary/15"
            >
              مدیریت سامانه (Orchard)
              <ExternalLink className="size-3.5" />
            </a>
          ) : null}
        </div>
      ) : null}

      <nav className="flex-1 space-y-5 overflow-y-auto p-3 scrollbar-slim" aria-label="منوی پنل کاربری">
        {NAV.map((group, gi) => (
          <div key={gi}>
            {group.title ? (
              <p className="mb-1.5 px-2.5 text-[10px] font-bold tracking-wide text-muted-foreground/70">
                {group.title}
              </p>
            ) : null}
            <ul className="space-y-1">
              {group.items.map((item) => {
                const active = isActive(item.to, item.to === routes.portal);
                const badgeCount =
                  item.badge === "notifications"
                    ? me.data?.unreadNotifications ?? 0
                    : item.badge === "cart"
                      ? cart.data?.count ?? 0
                      : 0;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-all",
                        active
                          ? "bg-primary/12 text-primary shadow-[inset_2px_0_0_0_var(--color-primary)]"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <item.icon className={cn("size-[17px] shrink-0", active ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground")} />
                      <span className="flex-1">{item.label}</span>
                      {badgeCount > 0 ? (
                        <span className="flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-extrabold text-primary-foreground">
                          {badgeCount > 9 ? "۹+" : String(badgeCount).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)])}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t p-4">
        <p className="text-[10px] leading-5 text-muted-foreground">
          پنل کاربری AbrIT
          <br />
          نسخه پلتفرم ۲.۰ — تعرفه رسمی ۱۴۰۵
        </p>
      </div>
    </div>
  );
}

function NotificationBell() {
  const router = useRouter();
  const me = useMe();
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = me.data?.unreadNotifications ?? 0;
  const recent = useMemo(() => (notifications.data ?? []).slice(0, 6), [notifications.data]);

  return (
    <DropdownMenu dir="rtl">
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-lg" aria-label="اعلان‌ها">
          <Bell className="size-[18px]" />
          {unread > 0 ? (
            <span className="absolute -top-0.5 -end-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-extrabold text-white">
              {unread > 9 ? "۹" : String(unread).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)])}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>اعلان‌ها</span>
          {unread > 0 ? (
            <button
              className="text-[11px] font-bold text-primary hover:underline"
              onClick={() => markRead.mutate({ all: true })}
            >
              علامت‌گذاری همه به‌عنوان خوانده‌شده
            </button>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recent.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">اعلان جدیدی ندارید.</p>
        ) : (
          recent.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className="flex cursor-pointer flex-col items-start gap-1 py-2.5"
              onClick={() => {
                if (!n.readAt) markRead.mutate({ ids: [n.id] });
                if (n.link) router.navigate(n.link);
              }}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className={cn("truncate text-xs font-bold", !n.readAt && "text-primary")}>{n.title}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatRelative(n.createdAt)}</span>
              </span>
              <span className="line-clamp-2 text-[11px] leading-5 text-muted-foreground">{n.body}</span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="justify-center text-xs font-bold text-primary" onClick={() => router.navigate(routes.portalNotifications)}>
          مشاهده همه اعلان‌ها
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const router = useRouter();
  const logout = useLogout();
  const me = useMe();
  const user = me.data?.user;
  if (!user) return null;
  return (
    <DropdownMenu dir="rtl">
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2.5 rounded-lg border p-1.5 ps-3 transition-colors hover:bg-accent"
          aria-label="منوی کاربر"
        >
          <span className="hidden text-start sm:block">
            <span className="block text-xs font-bold leading-4">{user.name ?? "کاربر AbrIT"}</span>
            <span className="block text-[10px] text-muted-foreground">{user.role === "customer" ? "مشتری" : user.role === "admin" ? "مدیر سیستم" : "کارشناس"}</span>
          </span>
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-xs font-extrabold text-primary">
            {(user.name ?? user.email).slice(0, 2)}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-[11px] text-muted-foreground" dir="ltr">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.navigate(routes.portalProfile)}>
          <User className="size-4" /> پروفایل
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.navigate(routes.portalSecurity)}>
          <ShieldCheck className="size-4" /> امنیت
        </DropdownMenuItem>
        {user.role !== "customer" ? (
          <DropdownMenuItem onClick={() => router.navigate(routes.admin)}>
            <ExternalLink className="size-4" /> مدیریت سامانه (Orchard)
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() =>
            logout.mutate(undefined, {
              onSuccess: () => router.navigate(routes.home),
            })
          }
        >
          <LogOut className="size-4" /> خروج از حساب
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const me = useMe();
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = me.data?.user ?? null;

  // Auth guard: unauthenticated visitors are sent to login (with return path).
  useEffect(() => {
    if (!me.isLoading && !user) {
      router.navigate(`${routes.login}?next=${encodeURIComponent(router.path)}`, { replace: true });
    }
  }, [me.isLoading, user, router]);

  if (me.isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <FullPageLoader label="در حال بررسی نشست…" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Persistent right sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-e bg-sidebar lg:block">
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sticky header */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-lg md:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-lg lg:hidden" aria-label="باز کردن منو">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 border-e bg-sidebar p-0">
              <SheetTitle className="sr-only">منوی پنل کاربری</SheetTitle>
              <div className="relative h-full">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMobileOpen(false)}
                  className="absolute end-3 top-3 z-10 rounded-lg"
                  aria-label="بستن منو"
                >
                  <X className="size-4" />
                </Button>
                <SidebarNav onNavigate={() => setMobileOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          <div className="flex items-center gap-2 lg:hidden">
            <Logo />
          </div>

          <div className="ms-auto flex items-center gap-1.5">
            <NotificationBell />
            <ThemeSwitcher />
            <UserMenu />
          </div>
        </header>

        {/* Routed content — animates while the shell persists */}
        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">
            <AnimatedContent>{children}</AnimatedContent>
          </div>
        </main>

        <footer className="mt-auto border-t bg-card/50">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[11px] text-muted-foreground md:px-6 lg:px-8">
            <span>© {new Date().getFullYear()} AbrIT — پنل کاربری</span>
            <span className="flex items-center gap-2">
              <StatusBadge status={me.data?.entitledPlanCode ? "active" : "not_provisioned"} label={me.data?.entitledPlanCode ? "اشتراک سازمانی فعال" : "بدون اشتراک فعال"} />
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
