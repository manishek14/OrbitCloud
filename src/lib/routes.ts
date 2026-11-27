// Central route map for the path-based SPA.
// Areas: public site (/), auth (/auth), customer portal (/portal).
// The administration (/admin) is the REAL Orchard Core application served
// behind the reverse proxy — a server route, not part of this SPA.

export const routes = {
  // Public
  home: "/",
  services: "/services",
  plans: "/plans",
  about: "/about",
  contact: "/contact",
  faq: "/faq",

  // Auth
  login: "/auth/login",
  register: "/auth/register",
  verifyOtp: "/auth/verify-otp",
  forgotPassword: "/auth/forgot-password",
  resetPassword: "/auth/reset-password",

  // Customer portal
  portal: "/portal",
  portalServices: "/portal/services",
  portalService: (id: string) => `/portal/services/${id}`,
  portalPlans: "/portal/plans",
  portalPlan: (id: string) => `/portal/plans/${id}`,
  portalCart: "/portal/cart",
  portalCheckout: "/portal/checkout",
  portalPaymentResult: "/portal/payment/result",
  portalOrders: "/portal/orders",
  portalBilling: "/portal/billing",
  portalDrive: "/portal/drive",
  portalTickets: "/portal/tickets",
  portalTicket: (id: string) => `/portal/tickets/${id}`,
  portalNotifications: "/portal/notifications",
  portalProfile: "/portal/profile",
  portalSecurity: "/portal/security",

  // Server route: the real Orchard Core administration (reverse proxy).
  admin: "/admin",
} as const;

export const publicNav = [
  { to: routes.home, label: "خانه" },
  { to: routes.services, label: "خدمات" },
  { to: routes.plans, label: "پلن‌ها و تعرفه" },
  { to: routes.about, label: "درباره Orbit" },
  { to: routes.contact, label: "تماس با ما" },
  { to: routes.faq, label: "سوالات متداول" },
] as const;
