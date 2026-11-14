"use client";

// Application shell: path router → area layout (public / auth / portal) →
// routed view with page transitions. The shell stays mounted while layouts
// persist per area and only the inner content animates.
//
// The administration area is intentionally NOT part of this SPA: /admin is
// served by the real Orchard Core application behind the reverse proxy. Any
// SPA-side /admin path falls through to a redirect to the real admin.

import { useEffect } from "react";
import { useRouter, matchRoute } from "@/lib/router";
import { routes } from "@/lib/routes";
import { useMe } from "@/lib/api/hooks";
import { PublicLayout } from "@/layouts/public-layout";
import { AuthLayout } from "@/layouts/auth-layout";
import { PortalLayout } from "@/layouts/portal-layout";

import HomeView from "@/views/public/home-view";
import ServicesView from "@/views/public/services-view";
import PlansView from "@/views/public/plans-view";
import AboutView from "@/views/public/about-view";
import ContactView from "@/views/public/contact-view";
import FaqView from "@/views/public/faq-view";
import NotFoundView from "@/views/public/not-found-view";

import LoginView from "@/views/auth/login-view";
import RegisterView from "@/views/auth/register-view";
import VerifyOtpView from "@/views/auth/verify-otp-view";
import ForgotPasswordView from "@/views/auth/forgot-password-view";
import ResetPasswordView from "@/views/auth/reset-password-view";

import PortalDashboardView from "@/views/portal/dashboard-view";
import PortalServicesView from "@/views/portal/services-view";
import PortalServiceDetailView from "@/views/portal/service-detail-view";
import PortalPlansView from "@/views/portal/plans-view";
import PortalPlanDetailView from "@/views/portal/plan-detail-view";
import CartView from "@/views/portal/cart-view";
import CheckoutView from "@/views/portal/checkout-view";
import PaymentResultView from "@/views/portal/payment-result-view";
import OrdersView from "@/views/portal/orders-view";
import BillingView from "@/views/portal/billing-view";
import DriveView from "@/views/portal/drive-view";
import TicketsView from "@/views/portal/tickets-view";
import TicketDetailView from "@/views/portal/ticket-detail-view";
import NotificationsView from "@/views/portal/notifications-view";
import ProfileView from "@/views/portal/profile-view";
import SecurityView from "@/views/portal/security-view";
import PortalSettingsView from "@/views/portal/settings-view";

type RouteDef = {
  pattern: string;
  view: (params: Record<string, string>) => React.ReactNode;
};

const ROUTES: RouteDef[] = [
  // Public
  { pattern: "/", view: () => <HomeView /> },
  { pattern: "/services", view: () => <ServicesView /> },
  { pattern: "/plans", view: () => <PlansView /> },
  { pattern: "/about", view: () => <AboutView /> },
  { pattern: "/contact", view: () => <ContactView /> },
  { pattern: "/faq", view: () => <FaqView /> },
  // Auth
  { pattern: "/auth/login", view: () => <LoginView /> },
  { pattern: "/auth/register", view: () => <RegisterView /> },
  { pattern: "/auth/verify-otp", view: () => <VerifyOtpView /> },
  { pattern: "/auth/forgot-password", view: () => <ForgotPasswordView /> },
  { pattern: "/auth/reset-password", view: () => <ResetPasswordView /> },
  // Portal
  { pattern: "/portal", view: () => <PortalDashboardView /> },
  { pattern: "/portal/services", view: () => <PortalServicesView /> },
  { pattern: "/portal/services/:id", view: (p) => <PortalServiceDetailView id={p.id} /> },
  { pattern: "/portal/plans", view: () => <PortalPlansView /> },
  { pattern: "/portal/plans/:id", view: (p) => <PortalPlanDetailView code={p.id} /> },
  { pattern: "/portal/cart", view: () => <CartView /> },
  { pattern: "/portal/checkout", view: () => <CheckoutView /> },
  { pattern: "/portal/payment/result", view: () => <PaymentResultView /> },
  { pattern: "/portal/orders", view: () => <OrdersView /> },
  { pattern: "/portal/billing", view: () => <BillingView /> },
  { pattern: "/portal/drive", view: () => <DriveView /> },
  { pattern: "/portal/tickets", view: () => <TicketsView /> },
  { pattern: "/portal/tickets/:id", view: (p) => <TicketDetailView id={p.id} /> },
  { pattern: "/portal/notifications", view: () => <NotificationsView /> },
  { pattern: "/portal/profile", view: () => <ProfileView /> },
  { pattern: "/portal/security", view: () => <SecurityView /> },
  { pattern: "/portal/settings", view: () => <PortalSettingsView /> },
];

function resolveRoute(path: string): { element: React.ReactNode; area: "public" | "auth" | "portal" | "server" } {
  for (const route of ROUTES) {
    const match = matchRoute(path, route.pattern);
    if (match) {
      const area = route.pattern.startsWith("/portal")
        ? "portal"
        : route.pattern.startsWith("/auth")
          ? "auth"
          : "public";
      return { element: route.view(match.params), area };
    }
  }
  // /admin (and anything else that belongs to the server side) → real Orchard.
  if (path.startsWith("/admin")) {
    return { element: <ServerAdminRedirect />, area: "server" };
  }
  return { element: <NotFoundView />, area: "public" };
}

/** Sends the browser to the real Orchard Core administration. */
function ServerAdminRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(routes.admin);
  }, [router]);
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <p className="text-xs text-muted-foreground">در حال انتقال به مدیریت سامانه…</p>
    </div>
  );
}

/** Redirect signed-in users away from auth pages. */
function AuthRedirectGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const me = useMe();
  const user = me.data?.user ?? null;
  useEffect(() => {
    if (!me.isLoading && user) {
      const next = router.query.next;
      if (next && next.startsWith("/") && !next.startsWith("/auth")) {
        router.replace(next);
      } else {
        // Administrators use the real Orchard administration (/admin), which
        // has its own separate authentication; everyone else → customer portal.
        router.replace(user.role === "customer" ? routes.portal : routes.admin);
      }
    }
  }, [me.isLoading, user, router]);
  if (user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-xs text-muted-foreground">در حال انتقال…</p>
      </div>
    );
  }
  return <>{children}</>;
}

export function AppShell() {
  const router = useRouter();
  const { element, area } = resolveRoute(router.path);

  if (area === "auth") {
    return (
      <AuthLayout>
        <AuthRedirectGuard>{element}</AuthRedirectGuard>
      </AuthLayout>
    );
  }
  if (area === "portal") {
    return <PortalLayout>{element}</PortalLayout>;
  }
  return <PublicLayout>{element}</PublicLayout>;
}
