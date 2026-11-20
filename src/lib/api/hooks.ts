"use client";

// Shared TanStack Query hooks for every data domain of the platform.
// Views should use these (and add local mutations via `api` when needed).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type {
  AdminAuditDTO,
  AdminCustomerDTO,
  AdminDashboardDTO,
  AdminDriveAccountDTO,
  AdminMediaDTO,
  AdminOrderDTO,
  AdminRecipeExportDTO,
  AdminReportDTO,
  AdminSettingsDTO,
  AdminTicketDTO,
  AuthSuccessDTO,
  CartResponse,
  SelectableGatewayDTO,
  CommerceCatalogDTO,
  ContentItemDTO,
  ContentListResponse,
  DriveOverviewDTO,
  InvoiceDTO,
  MeResponse,
  NotificationDTO,
  OtpRequestResultDTO,
  OrderDTO,
  OrderListEntryDTO,
  PaymentInitDTO,
  PaymentResultDTO,
  PanelUserDTO,
  PortalDashboardDTO,
  QuoteInputDTO,
  QuoteResultDTO,
  RecoverRequestResultDTO,
  ServiceDTO,
  SessionDTO,
  SettingsResponse,
  SubscriptionDTO,
  TicketDTO,
  TicketListEntryDTO,
  TransactionDTO,
} from "./types";

// ---------------------------------------------------------------------------
// Auth & profile
// ---------------------------------------------------------------------------

export function useMe() {
  return useQuery<MeResponse>({
    queryKey: ["me"],
    queryFn: () => api.get<MeResponse>("/api/me"),
    staleTime: 10_000,
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>("/api/auth/logout"),
    onSuccess: () => {
      client.clear();
    },
  });
}

/**
 * Seeds the ["me"] cache from an auth-success response BEFORE navigation.
 *
 * ROOT-CAUSE FIX (OTP/password login bounce): previously these mutations only
 * called invalidateQueries(), which refetches /api/me in the BACKGROUND while
 * the cache still holds {user:null}. The portal layout guard then saw
 * `!isLoading && !user` and bounced the just-authenticated user back to
 * /auth/login before the refetch landed — the "success toast but stuck on the
 * OTP page" symptom. Writing the authenticated user into the cache first
 * makes the guard observe the session immediately; invalidateQueries() still
 * refetches everything for freshness.
 */
function seedMeCache(client: ReturnType<typeof useQueryClient>, user: PanelUserDTO): void {
  client.setQueryData<MeResponse>(["me"], (prev) => ({
    user,
    role: user.role,
    unreadNotifications: prev?.unreadNotifications ?? 0,
    entitledPlanCode: prev?.entitledPlanCode ?? null,
  }));
}

export function useLoginPassword() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { identifier: string; password: string }) =>
      api.post<AuthSuccessDTO>("/api/auth/login", input),
    onSuccess: (result) => {
      seedMeCache(client, result.user);
      client.invalidateQueries();
    },
  });
}

export function useRequestOtp() {
  return useMutation({
    mutationFn: (input: { mobile: string; purpose: "login" | "register" | "recover" }) =>
      api.post<OtpRequestResultDTO>("/api/auth/otp/request", input),
  });
}

export function useVerifyOtpLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { mobile: string; code: string }) =>
      api.post<AuthSuccessDTO>("/api/auth/otp/verify", input),
    onSuccess: (result) => {
      seedMeCache(client, result.user);
      client.invalidateQueries();
    },
  });
}

export function useRegister() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; email: string; mobile: string; password: string; code: string }) =>
      api.post<AuthSuccessDTO>("/api/auth/register", input),
    onSuccess: (result) => {
      seedMeCache(client, result.user);
      client.invalidateQueries();
    },
  });
}

export function useRecoverRequest() {
  return useMutation({
    mutationFn: (input: { email?: string; mobile?: string }) =>
      api.post<RecoverRequestResultDTO | OtpRequestResultDTO>("/api/auth/recover/request", input),
  });
}

export function useRecoverReset() {
  return useMutation({
    mutationFn: (input: { email: string; code: string; newPassword: string; confirm: string }) =>
      api.post<{ ok: true; message: string }>("/api/auth/recover/reset", input),
  });
}

export function useUpdateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name?: string; company?: string }) =>
      api.patch<{ user: PanelUserDTO }>("/api/profile", input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api.post<{ ok: true }>("/api/profile/password", input),
  });
}

export function useSessions() {
  return useQuery<SessionDTO[]>({
    queryKey: ["sessions"],
    queryFn: () => api.get<SessionDTO[]>("/api/profile/sessions"),
  });
}

export function useRevokeSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/api/profile/sessions/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

// ---------------------------------------------------------------------------
// Drive
// ---------------------------------------------------------------------------

export function useDriveOverview() {
  return useQuery<DriveOverviewDTO>({
    queryKey: ["drive-overview"],
    queryFn: () => api.get<DriveOverviewDTO>("/api/drive/status"),
    staleTime: 30_000,
  });
}

export function useActivateDrive() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { username: string; password: string; planCode: string }) =>
      api.post<{ ok: true; drive: DriveOverviewDTO }>("/api/drive/activate", input),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useChangeDriveQuota() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { planCode: string }) =>
      api.post<{ ok: true; drive: DriveOverviewDTO }>("/api/drive/quota", input),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useSetDriveEnabled() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { enabled: boolean }) =>
      api.post<{ ok: true; drive: DriveOverviewDTO }>("/api/drive/enabled", input),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useSyncDrive() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true; drive: DriveOverviewDTO }>("/api/drive/sync"),
    onSuccess: () => client.invalidateQueries(),
  });
}

// ---------------------------------------------------------------------------
// Commerce
// ---------------------------------------------------------------------------

export function useCommerceCatalog() {
  return useQuery<CommerceCatalogDTO>({
    queryKey: ["commerce-catalog"],
    queryFn: () => api.get<CommerceCatalogDTO>("/api/commerce/catalog"),
    staleTime: 5 * 60_000,
  });
}

export function useQuoteQuery(input: QuoteInputDTO | null) {
  return useQuery<QuoteResultDTO>({
    queryKey: ["commerce-quote", input],
    queryFn: () => api.post<QuoteResultDTO>("/api/commerce/quote", input),
    staleTime: 60_000,
    retry: 1,
    enabled: input !== null,
  });
}

export function useCart() {
  return useQuery<CartResponse>({
    queryKey: ["cart"],
    queryFn: () => api.get<CartResponse>("/api/cart"),
    staleTime: 5_000,
  });
}

export function useAddToCart() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: QuoteInputDTO) => api.post<CartResponse>("/api/cart", input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["cart"] }),
  });
}

export function useRemoveCartItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<CartResponse>(`/api/cart/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["cart"] }),
  });
}

export function useCheckout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { invoiceTitle: string; invoiceCompany?: string }) =>
      api.post<{ order: OrderDTO }>("/api/checkout", input),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["cart"] });
      client.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useInitPayment() {
  return useMutation({
    mutationFn: (input: { orderId: string; gateway?: string }) =>
      api.post<PaymentInitDTO>("/api/payments/init", input),
  });
}

export function useSelectableGateways() {
  return useQuery<SelectableGatewayDTO[]>({
    queryKey: ["payment-gateways"],
    queryFn: () => api.get<SelectableGatewayDTO[]>("/api/payments/gateways"),
    staleTime: 60_000,
  });
}

export function usePaymentResult(ref: string | null) {
  return useQuery<PaymentResultDTO>({
    queryKey: ["payment-result", ref],
    queryFn: () => api.get<PaymentResultDTO>(`/api/payments/result?ref=${encodeURIComponent(ref ?? "")}`),
    enabled: Boolean(ref),
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 4000 : false),
  });
}

export function useOrders() {
  return useQuery<OrderListEntryDTO[]>({
    queryKey: ["orders"],
    queryFn: () => api.get<OrderListEntryDTO[]>("/api/orders"),
  });
}

export function useOrder(id: string | null) {
  return useQuery<OrderDTO>({
    queryKey: ["order", id],
    queryFn: () => api.get<OrderDTO>(`/api/orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useCancelOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: true }>(`/api/orders/${id}/cancel`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["orders"] });
      client.invalidateQueries({ queryKey: ["order"] });
      client.invalidateQueries({ queryKey: ["portal-dashboard"] });
    },
  });
}

export function useInvoices() {
  return useQuery<InvoiceDTO[]>({
    queryKey: ["invoices"],
    queryFn: () => api.get<InvoiceDTO[]>("/api/invoices"),
  });
}

export function useInvoice(id: string | null) {
  return useQuery<InvoiceDTO>({
    queryKey: ["invoice", id],
    queryFn: () => api.get<InvoiceDTO>(`/api/invoices/${id}`),
    enabled: Boolean(id),
  });
}

export function useTransactions() {
  return useQuery<TransactionDTO[]>({
    queryKey: ["transactions"],
    queryFn: () => api.get<TransactionDTO[]>("/api/transactions"),
  });
}

// ---------------------------------------------------------------------------
// Services / subscriptions / portal dashboard
// ---------------------------------------------------------------------------

export function useServices() {
  return useQuery<ServiceDTO[]>({
    queryKey: ["services"],
    queryFn: () => api.get<ServiceDTO[]>("/api/services"),
  });
}

export function useService(id: string | null) {
  return useQuery<ServiceDTO>({
    queryKey: ["service", id],
    queryFn: () => api.get<ServiceDTO>(`/api/services/${id}`),
    enabled: Boolean(id),
  });
}

export function useSubscriptions() {
  return useQuery<SubscriptionDTO[]>({
    queryKey: ["subscriptions"],
    queryFn: () => api.get<SubscriptionDTO[]>("/api/subscriptions"),
  });
}

export function usePortalDashboard() {
  return useQuery<PortalDashboardDTO>({
    queryKey: ["portal-dashboard"],
    queryFn: () => api.get<PortalDashboardDTO>("/api/portal/dashboard"),
  });
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export function useTickets() {
  return useQuery<TicketListEntryDTO[]>({
    queryKey: ["tickets"],
    queryFn: () => api.get<TicketListEntryDTO[]>("/api/tickets"),
  });
}

export function useTicket(id: string | null) {
  return useQuery<TicketDTO>({
    queryKey: ["ticket", id],
    queryFn: () => api.get<TicketDTO>(`/api/tickets/${id}`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });
}

export function useCreateTicket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { subject: string; category: string; priority: string; body: string }) =>
      api.post<{ ticket: TicketDTO }>("/api/tickets", input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useReplyTicket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: string }) =>
      api.post<{ ticket: TicketDTO }>(`/api/tickets/${input.id}/messages`, { body: input.body }),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: ["tickets"] });
      client.invalidateQueries({ queryKey: ["ticket", variables.id] });
    },
  });
}

export function useCloseTicket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: true }>(`/api/tickets/${id}/close`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["tickets"] });
      client.invalidateQueries({ queryKey: ["ticket"] });
    },
  });
}

export function useContactForm() {
  return useMutation({
    mutationFn: (input: { name: string; email: string; mobile?: string; subject: string; message: string }) =>
      api.post<{ ok: true; message: string }>("/api/contact", input),
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function useNotifications() {
  return useQuery<NotificationDTO[]>({
    queryKey: ["notifications"],
    queryFn: () => api.get<NotificationDTO[]>("/api/notifications"),
  });
}

export function useMarkNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids?: string[]; all?: boolean }) =>
      api.post<{ ok: true }>("/api/notifications/read", input),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["notifications"] });
      client.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Public content
// ---------------------------------------------------------------------------

export function usePublicContent(type: "faq" | "service" | "page" | "article", slug?: string) {
  return useQuery<ContentItemDTO[]>({
    queryKey: ["public-content", type, slug ?? null],
    queryFn: () =>
      api.get<ContentListResponse>(
        `/api/content?type=${encodeURIComponent(type)}${slug ? `&slug=${encodeURIComponent(slug)}` : ""}`,
      ).then((r) => r.items),
    staleTime: 60_000,
  });
}

export function usePublicSettings() {
  return useQuery<SettingsResponse>({
    queryKey: ["public-settings"],
    queryFn: () => api.get<SettingsResponse>("/api/content/settings"),
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export function useAdminDashboard() {
  return useQuery<AdminDashboardDTO>({
    queryKey: ["admin-dashboard"],
    queryFn: () => api.get<AdminDashboardDTO>("/api/admin/dashboard"),
    refetchInterval: 60_000,
  });
}

export function useAdminCustomers(query?: string) {
  return useQuery<AdminCustomerDTO[]>({
    queryKey: ["admin-customers", query ?? ""],
    queryFn: () =>
      api.get<AdminCustomerDTO[]>(`/api/admin/customers${query ? `?query=${encodeURIComponent(query)}` : ""}`),
  });
}

export function useAdminOrders(status?: string) {
  return useQuery<AdminOrderDTO[]>({
    queryKey: ["admin-orders", status ?? ""],
    queryFn: () => api.get<AdminOrderDTO[]>(`/api/admin/orders${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  });
}

export function useAdminOrder(id: string | null) {
  return useQuery<AdminOrderDTO>({
    queryKey: ["admin-order", id],
    queryFn: () => api.get<AdminOrderDTO>(`/api/admin/orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useAdminInvoices() {
  return useQuery<InvoiceDTO[]>({
    queryKey: ["admin-invoices"],
    queryFn: () => api.get<InvoiceDTO[]>("/api/admin/invoices"),
  });
}

export function useAdminTransactions() {
  return useQuery<TransactionDTO[]>({
    queryKey: ["admin-transactions"],
    queryFn: () => api.get<TransactionDTO[]>("/api/admin/payments"),
  });
}

export function useAdminSubscriptions() {
  return useQuery<Array<SubscriptionDTO & { customerEmail: string; customerName: string | null }>>({
    queryKey: ["admin-subscriptions"],
    queryFn: () => api.get<Array<SubscriptionDTO & { customerEmail: string; customerName: string | null }>>("/api/admin/subscriptions"),
  });
}

export function useAdminTickets(status?: string) {
  return useQuery<AdminTicketDTO[]>({
    queryKey: ["admin-tickets", status ?? ""],
    queryFn: () => api.get<AdminTicketDTO[]>(`/api/admin/tickets${status ? `?status=${encodeURIComponent(status)}` : ""}`),
    refetchInterval: 30_000,
  });
}

export function useAdminTicket(id: string | null) {
  return useQuery<TicketDTO & { customerEmail: string | null }>({
    queryKey: ["admin-ticket", id],
    queryFn: () => api.get<TicketDTO & { customerEmail: string | null }>(`/api/admin/tickets/${id}`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });
}

export function useAdminReplyTicket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: string }) =>
      api.post<{ ok: true }>(`/api/admin/tickets/${input.id}/messages`, { body: input.body }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin-tickets"] });
      client.invalidateQueries({ queryKey: ["admin-ticket"] });
    },
  });
}

export function useAdminCloseTicket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: true }>(`/api/admin/tickets/${id}/close`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-tickets"] }),
  });
}

export function useAdminDriveAccounts() {
  return useQuery<AdminDriveAccountDTO[]>({
    queryKey: ["admin-drive"],
    queryFn: () => api.get<AdminDriveAccountDTO[]>("/api/admin/drive"),
  });
}

export function useAdminDriveAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; action: "sync" | "enable" | "disable" }) =>
      api.post<{ ok: true; message: string }>(`/api/admin/drive/${input.accountId}/${input.action}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-drive"] }),
  });
}

export function useAdminAudit() {
  return useQuery<AdminAuditDTO[]>({
    queryKey: ["admin-audit"],
    queryFn: () => api.get<AdminAuditDTO[]>("/api/admin/audit"),
  });
}

export function useAdminContent(type?: string) {
  return useQuery<ContentItemDTO[]>({
    queryKey: ["admin-content", type ?? ""],
    queryFn: () => api.get<ContentItemDTO[]>(`/api/admin/content${type ? `?type=${encodeURIComponent(type)}` : ""}`),
  });
}

export function useAdminContentItem(id: string | null) {
  return useQuery<ContentItemDTO>({
    queryKey: ["admin-content-item", id],
    queryFn: () => api.get<ContentItemDTO>(`/api/admin/content/${id}`),
    enabled: Boolean(id),
  });
}

export function useSaveContent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ContentItemDTO> & { id?: string }) =>
      input.id
        ? api.patch<ContentItemDTO>(`/api/admin/content/${input.id}`, input)
        : api.post<ContentItemDTO>("/api/admin/content", input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-content"] }),
  });
}

export function useDeleteContent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/api/admin/content/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-content"] }),
  });
}

export function useAdminMedia() {
  return useQuery<AdminMediaDTO[]>({
    queryKey: ["admin-media"],
    queryFn: () => api.get<AdminMediaDTO[]>("/api/admin/media"),
  });
}

export function useUploadMedia() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => api.upload<{ asset: AdminMediaDTO }>("/api/admin/media", form),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-media"] }),
  });
}

export function useDeleteMedia() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/api/admin/media/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-media"] }),
  });
}

export function useAdminUsers() {
  return useQuery<AdminCustomerDTO[]>({
    queryKey: ["admin-users"],
    queryFn: () => api.get<AdminCustomerDTO[]>("/api/admin/users"),
  });
}

export function useAdminUpdateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; role?: string; status?: string; name?: string }) =>
      api.patch<{ ok: true }>(`/api/admin/customers/${input.id}`, input),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin-users"] });
      client.invalidateQueries({ queryKey: ["admin-customers"] });
    },
  });
}

export function useAdminReports() {
  return useQuery<AdminReportDTO>({
    queryKey: ["admin-reports"],
    queryFn: () => api.get<AdminReportDTO>("/api/admin/reports"),
  });
}

export function useAdminSettings() {
  return useQuery<AdminSettingsDTO>({
    queryKey: ["admin-settings"],
    queryFn: () => api.get<AdminSettingsDTO>("/api/admin/settings"),
    staleTime: 60_000,
  });
}

export function useAdminRecipeExport() {
  return useQuery<AdminRecipeExportDTO>({
    queryKey: ["admin-recipe-export"],
    queryFn: () => api.get<AdminRecipeExportDTO>("/api/admin/recipes"),
    enabled: false, // fetched on demand (button)
  });
}

export function useAdminUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, string>) =>
      api.post<{ ok: true }>("/api/admin/settings", input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-settings"] }),
  });
}

export function useAdminQueries() {
  return useQuery<ContentItemDTO[]>({
    queryKey: ["admin-queries"],
    queryFn: () => api.get<ContentItemDTO[]>("/api/admin/queries"),
  });
}
