"use client";

// ============================================================================
// API contract types (client-safe mirrors of server responses).
// This file is the single source of truth for frontend/backend DTO shapes.
// ============================================================================

export interface PanelUserDTO {
  id: string;
  email: string;
  name: string | null;
  mobile: string | null;
  company: string | null;
  role: "admin" | "staff" | "customer";
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt: string | null;
}

export interface MeResponse {
  user: PanelUserDTO | null;
  role: "admin" | "staff" | "customer" | null;
  unreadNotifications: number;
  entitledPlanCode: string | null;
}

// ---------------------------------------------------------------------------
// Drive (Nextcloud) — mirrors /api/drive/* (previously tested contract)
// ---------------------------------------------------------------------------

export interface DriveUsageDTO {
  usedBytes: number;
  totalBytes: number;
  freeBytes: number;
  relative: number;
  unlimited: boolean;
}

export interface DriveAccountDTO {
  ncUsername: string;
  ncEmail: string | null;
  ncDisplayName: string | null;
  planCode: string;
  planNameFa: string;
  quotaLabel: string;
  quotaBytes: number;
  status: "active" | "disabled";
  provisionedAt: string;
  lastSyncedAt: string | null;
}

export interface DriveEventDTO {
  id: string;
  type: string;
  detail: string | null;
  createdAt: string;
}

export type DriveStateDTO =
  | "not_provisioned"
  | "ready"
  | "missing_on_server"
  | "unreachable"
  | "auth_failed"
  | "not_configured";

export interface DriveOverviewDTO {
  mode: "live" | "simulation";
  state: DriveStateDTO;
  detail: string | null;
  pendingUsername?: string;
  account: DriveAccountDTO | null;
  usage: DriveUsageDTO | null;
  loginUrl: string;
  loginUrlLabel: string;
  events: DriveEventDTO[];
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Commerce: catalog + quote (authoritative 1405 tariffs, server-computed)
// ---------------------------------------------------------------------------

export interface CommercialPackageDTO {
  code: string;
  nameFa: string;
  nameEn: string;
  audienceFa: string;
  order: number;
  monthlyPriceToman: number;
  /** Free plan is not purchasable — activation happens through Orbit Drive. */
  orderable: boolean;
  includedUsers: number;
  includedEndpoints: number;
  includedServers: number;
  includedSites: number;
  includedNetworkDevices: number;
  driveQuotaBytes: number;
  extraUserFeeTomanPerMonth: number;
  extraEndpointFeeTomanPerMonth: number;
  slaLabelFa: string;
  slaDetailFa: string;
  supportHoursFa: string;
  benefitsFa: string[];
  featured: boolean;
  vpsFa: string | null;
  onSiteFa: string;
}

export interface ContractPolicyDTO {
  months: number;
  discountRate: number;
  onboardingRate: number;
  labelFa: string;
  discountLabelFa: string;
  onboardingLabelFa: string;
  /** Present while the policy still requires final business sign-off. */
  requiresBusinessApproval?: boolean;
  noteFa?: string;
}

export interface CommerceCatalogDTO {
  version: number;
  generatedAt: string;
  packages: CommercialPackageDTO[];
  contracts: ContractPolicyDTO[];
  limits: { maxQuotableUsers: number; maxQuotableEndpoints: number };
  policy: {
    prepaid: string;
    minimumMonths: number;
    allowedMonths: number[];
    discountScope: string;
    onboardingScope: string;
    customAssessment: string;
    slaNote: string;
    checkoutNote: string;
  };
}

export interface QuoteInputDTO {
  packageCode: string;
  months: number;
  users: number;
  endpoints: number;
}

export interface QuoteLineItemDTO {
  key: string;
  labelFa: string;
  amountToman: number;
  noteFa?: string;
}

export interface QuoteBreakdownDTO {
  packageCode: string;
  packageNameFa: string;
  months: number;
  users: number;
  endpoints: number;
  monthlyBaseToman: number;
  baseSubtotalToman: number;
  discountRate: number;
  discountToman: number;
  baseAfterDiscountToman: number;
  extraUsers: number;
  extraUserFeePerMonthToman: number;
  extraUsersTotalToman: number;
  extraEndpoints: number;
  extraEndpointFeePerMonthToman: number;
  extraEndpointsTotalToman: number;
  onboardingRate: number;
  onboardingToman: number;
  totalToman: number;
  perMonthEquivalentToman: number;
}

export interface QuoteSnapshotDTO {
  version: number;
  quoteId: string;
  createdAt: string;
  packageCode: string;
  months: number;
  users: number;
  endpoints: number;
  totalToman: number;
  checksum: string;
}

export interface QuoteResultDTO {
  valid: boolean;
  errors: string[];
  needsCustomAssessment: boolean;
  breakdown: QuoteBreakdownDTO | null;
  lineItems: QuoteLineItemDTO[];
  snapshot: QuoteSnapshotDTO | null;
  checkoutEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Cart / checkout / orders / payments / billing
// ---------------------------------------------------------------------------

export interface CartItemDTO {
  id: string;
  input: QuoteInputDTO;
  quote: QuoteResultDTO;
  addedAt: string;
}

export interface CartResponse {
  items: CartItemDTO[];
  totalToman: number;
  count: number;
}

export interface OrderItemSnapshotDTO {
  input: QuoteInputDTO;
  packageNameFa: string;
  totalToman: number;
  lineItems: QuoteLineItemDTO[];
  breakdown: QuoteBreakdownDTO;
  snapshot: QuoteSnapshotDTO;
}

export interface OrderDTO {
  id: string;
  orderNumber: string;
  status: "pending_payment" | "paid" | "cancelled";
  itemCount: number;
  totalToman: number;
  items: OrderItemSnapshotDTO[];
  invoiceTitle: string;
  invoiceCompany: string | null;
  createdAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
}

export interface OrderListEntryDTO {
  id: string;
  orderNumber: string;
  status: OrderDTO["status"];
  itemCount: number;
  totalToman: number;
  createdAt: string;
  paidAt: string | null;
}

export interface PaymentInitDTO {
  ref: string;
  gatewayUrl: string;
  amountToman: number;
}

export interface SelectableGatewayDTO {
  gateway: "zarinpal" | "zibal" | "mock";
  labelFa: string;
  mode: string;
  enabled: boolean;
  noteFa: string;
}

export interface PaymentResultDTO {
  ref: string;
  status: "pending" | "succeeded" | "failed" | "cancelled";
  gateway: string;
  gatewayLabel?: string;
  amountToman: number;
  order: { id: string; orderNumber: string; status: OrderDTO["status"] } | null;
  invoice: { id: string; number: string } | null;
  finalizedAt: string | null;
}

export interface InvoiceDTO {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  amountToman: number;
  status: "issued" | "paid" | "void";
  title: string;
  company: string | null;
  issuedAt: string;
  paidAt: string | null;
  items: OrderItemSnapshotDTO[];
}

export interface TransactionDTO {
  id: string;
  ref: string;
  orderNumber: string;
  gateway: string;
  amountToman: number;
  status: PaymentResultDTO["status"];
  createdAt: string;
  finalizedAt: string | null;
}

// ---------------------------------------------------------------------------
// Services / subscriptions
// ---------------------------------------------------------------------------

export interface SubscriptionDTO {
  id: string;
  packageCode: string;
  packageNameFa: string;
  months: number;
  users: number;
  endpoints: number;
  status: "active" | "expired" | "cancelled";
  startsAt: string;
  expiresAt: string;
  priceTotalToman: number;
  driveQuotaBytes: number | null;
  createdAt: string;
}

export interface ServiceDTO {
  id: string;
  type: "managed_it" | "drive";
  title: string;
  status: "active" | "pending" | "suspended" | "expired";
  activatedAt: string | null;
  expiresAt: string | null;
  subscriptionId: string | null;
  metadata: {
    packageCode?: string;
    packageNameFa?: string;
    planCode?: string;
    quotaLabel?: string;
    ncUsername?: string;
    users?: number;
    endpoints?: number;
    [key: string]: unknown;
  };
  createdAt: string;
}

export interface PortalDashboardDTO {
  activeServices: number;
  totalServices: number;
  subscription: { active: boolean; packageNameFa: string | null; expiresAt: string | null } | null;
  entitledPlanCode: string | null;
  recentOrders: OrderListEntryDTO[];
  recentTransactions: TransactionDTO[];
  drive: { state: DriveStateDTO; usedBytes: number | null; totalBytes: number | null; planNameFa: string | null };
  unreadNotifications: number;
  tickets: { open: number; answered: number; total: number };
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export interface TicketMessageDTO {
  id: string;
  senderRole: "customer" | "staff" | "system";
  senderName: string;
  body: string;
  createdAt: string;
}

export interface TicketDTO {
  id: string;
  number: string;
  subject: string;
  category: "technical" | "billing" | "sales" | "drive" | "other";
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "answered" | "pending_customer" | "closed";
  guestName: string | null;
  guestEmail: string | null;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessageDTO[];
}

export interface TicketListEntryDTO {
  id: string;
  number: string;
  subject: string;
  category: TicketDTO["category"];
  priority: TicketDTO["priority"];
  status: TicketDTO["status"];
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messageCount: number;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationDTO {
  id: string;
  category: "order" | "payment" | "drive" | "ticket" | "system" | "security";
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface OtpRequestResultDTO {
  ok: boolean;
  message: string;
  delivery: "display" | "sms";
  code?: string; // present only in the sandbox display delivery mode
  expiresInSeconds: number;
  /** Seconds before another code may be requested (UI resend countdown). */
  resendCooldownSeconds?: number;
  /** Configured code length — the OTP input renders this many slots. */
  codeLength?: number;
  retryAfterSeconds?: number;
}

export interface AuthSuccessDTO {
  user: PanelUserDTO;
  redirect: string;
}

export interface RecoverRequestResultDTO {
  ok: boolean;
  message: string;
  delivery: "display" | "email";
  code?: string;
  expiresInSeconds: number;
}

export interface SessionDTO {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

// ---------------------------------------------------------------------------
// Content (public site, managed from the admin)
// ---------------------------------------------------------------------------

export interface ContentItemDTO {
  id: string;
  type: "page" | "faq" | "service" | "article";
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  status: "published" | "draft";
  sortOrder: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentListResponse {
  items: ContentItemDTO[];
}

export interface SettingsResponse {
  settings: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface AdminDashboardDTO {
  totals: {
    customers: number;
    activeSubscriptions: number;
    newOrders: number;
    pendingPayments: number;
    confirmedRevenueToman: number;
    activeDriveAccounts: number;
    pendingTickets: number;
  };
  provisioning: { active: number; disabled: number; total: number };
  recentOrders: Array<OrderListEntryDTO & { customerName: string | null }>;
  recentTransactions: Array<{
    ref: string;
    orderNumber: string | null;
    gateway: string;
    amountToman: number;
    status: string;
    createdAt: string;
  }>;
  recentActivity: Array<{
    id: string;
    actorLabel: string;
    action: string;
    entityType: string;
    entityId: string | null;
    createdAt: string;
  }>;
}

export interface AdminCustomerDTO {
  id: string;
  email: string;
  name: string | null;
  mobile: string | null;
  company: string | null;
  role: PanelUserDTO["role"];
  status: PanelUserDTO["status"];
  createdAt: string;
  lastLoginAt: string | null;
  orderCount: number;
  paidTotalToman: number;
  hasDrive: boolean;
  activeSubscription: string | null;
}

/** Paginated envelope returned by /api/admin/customers and /api/admin/users. */
export interface AdminCustomerListDTO {
  items: AdminCustomerDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminOrderDTO extends OrderDTO {
  customer: { id: string; email: string; name: string | null } | null;
}

export interface AdminDriveAccountDTO {
  id: string;
  customer: { id: string; email: string; name: string | null } | null;
  ncUsername: string;
  ncDisplayName: string | null;
  planCode: string;
  planNameFa: string;
  quotaBytes: number;
  status: "active" | "disabled";
  provisionedAt: string;
  lastSyncedAt: string | null;
  eventCount: number;
}

export interface AdminTicketDTO extends TicketListEntryDTO {
  customerName: string | null;
  customerEmail: string | null;
  guestName: string | null;
  guestEmail: string | null;
}

export interface AdminAuditDTO {
  id: string;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metaJson: string | null;
  createdAt: string;
}

export interface AdminMediaDTO {
  id: string;
  name: string;
  path: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
}

export interface AdminReportDTO {
  revenueByMonth: Array<{ month: string; totalToman: number; orderCount: number }>;
  ordersByStatus: Array<{ status: string; count: number }>;
  planDistribution: Array<{ packageCode: string; packageNameFa: string; count: number }>;
  totalPaidOrders: number;
  totalRevenueToman: number;
}

export interface AdminSettingsDTO {
  nextcloud: { mode: "live" | "simulation"; configured: boolean; loginUrl: string };
  payments: Array<{ gateway: string; labelFa: string; enabled: boolean; noteFa: string }>;
  otpDelivery: "display" | "sms";
  recoveryDelivery: "display" | "email";
}

export interface AdminRecipeExportDTO {
  version: number;
  exportedAt: string;
  contentItems: ContentItemDTO[];
}

export interface AdminDriveActionDTO {
  ok: boolean;
  message: string;
}

export interface ApiErrorShape {
  error: { code: string; message: string };
}
