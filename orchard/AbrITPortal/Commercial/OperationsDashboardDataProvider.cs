// ============================================================================
// Admin dashboard KPI provider — feeds the AbrIT admin theme dashboard
// (TheAdmin-based AdminDashboard shape) with REAL business numbers from the
// canonical commerce application (Next.js + PostgreSQL) through the
// documented server-to-server API. No fabricated numbers: when the commerce
// service is unreachable, the dashboard shows an explicit unavailable state.
//
// Full-remediation audit §4.4: the provider now also surfaces the recent
// orders, recent transactions and recent admin activity that the portal's
// dashboard endpoint returns — previously these panels were permanently
// empty even though the data existed.
// ============================================================================

using AbrITAdminTheme.Admin;

namespace AbrITPortal.Commercial;

public sealed class OperationsDashboardDataProvider(CommerceApiClient commerce) : IAdminDashboardDataProvider
{
    public async Task<AdminDashboardData> GetAsync(CancellationToken cancellationToken)
    {
        if (!commerce.IsConfigured)
        {
            return Unavailable("اتصال به سرویس تجاری پیکربندی نشده است.");
        }

        CommerceTotals? totals;
        try
        {
            totals = await commerce.GetTotalsAsync(cancellationToken);
        }
        catch (Exception)
        {
            return Unavailable("سرویس تجاری در دسترس نیست؛ شاخص‌ها موقتاً ناموجود است.");
        }

        if (totals is null)
        {
            return Unavailable("پاسخ سرویس تجاری قابل تفسیر نبود.");
        }

        return new AdminDashboardData
        {
            Customers = Fa(totals.Customers),
            Orders = Fa(totals.NewOrders),
            PendingOrders = Fa(totals.PendingPayments),
            ActiveServices = Fa(totals.ActiveSubscriptions),
            PaymentAttempts = Fa(totals.PendingPayments),
            // SMS / failed-payment metrics have no wired data source yet —
            // flagged so the dashboard hides those cards instead of showing
            // permanently-unavailable placeholders (audit UI-8).
            SmsMetricsAvailable = false,
            DriveConfiguration = Fa(totals.ActiveDriveAccounts) + " حساب فعال",
            RecentActivityAvailable = totals.RecentActivity is not null,
            RecentOrders = totals.RecentOrders?.Select(o => new DashboardOrder(
                o.Id, o.OrderNumber, o.Status, ViewFormats.FaToman(o.TotalToman), o.CustomerName,
                ViewFormats.CompactDate(o.CreatedAt))).ToArray() ?? [],
            RecentTransactions = totals.RecentTransactions?.Select(t => new DashboardTransaction(
                t.Ref, t.OrderNumber, t.Gateway, ViewFormats.FaToman(t.AmountToman), t.Status,
                ViewFormats.CompactDate(t.CreatedAt))).ToArray() ?? [],
            RecentActivity = totals.RecentActivity?.Select(a => new DashboardActivity(
                a.ActorLabel, a.Action, a.EntityType, ViewFormats.CompactDate(a.CreatedAt))).ToArray() ?? [],
        };
    }

    // Persian digits for KPI values (audit UI-6 — one numeral system).
    private static string Fa(int value) => ViewFormats.FaNumber(value);

    private static AdminDashboardData Unavailable(string reason) => new()
    {
        Unavailable = true,
        UnavailableReason = reason,
        Customers = reason,
        Orders = reason,
        PendingOrders = reason,
        ActiveServices = reason,
        PaymentAttempts = reason,
        FailedPayments = reason,
        SmsQueue = reason,
        FailedSms = reason,
        BackgroundJobs = reason,
        DriveConfiguration = reason,
        RecentActivityAvailable = false,
        RecentOrders = Array.Empty<DashboardOrder>(),
        RecentTransactions = Array.Empty<DashboardTransaction>(),
        RecentActivity = Array.Empty<DashboardActivity>(),
    };
}
