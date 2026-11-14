// ============================================================================
// Admin dashboard KPI provider — feeds the AbrIT admin theme dashboard
// (TheAdmin-based AdminDashboard shape) with REAL business numbers from the
// canonical commerce application (Next.js + PostgreSQL) through the
// documented server-to-server API. No fabricated numbers: when the commerce
// service is unreachable, the dashboard shows an explicit unavailable state.
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
            Customers = totals.Customers.ToString("N0"),
            Orders = totals.NewOrders.ToString("N0"),
            PendingOrders = totals.PendingPayments.ToString("N0"),
            ActiveServices = totals.ActiveSubscriptions.ToString("N0"),
            PaymentAttempts = totals.PendingPayments.ToString("N0"),
            FailedPayments = "دادهٔ معتبر موجود نیست",
            SmsQueue = "دادهٔ معتبر موجود نیست",
            FailedSms = "دادهٔ معتبر موجود نیست",
            BackgroundJobs = "دادهٔ معتبر موجود نیست",
            DriveConfiguration = totals.ActiveDriveAccounts.ToString("N0") + " حساب فعال",
            RegistrationDatesAvailable = false,
            RecentOrders = Array.Empty<DashboardOrder>(),
            RecentCustomers = Array.Empty<DashboardCustomer>(),
        };
    }

    private static AdminDashboardData Unavailable(string reason) => new()
    {
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
        RegistrationDatesAvailable = false,
        RecentOrders = Array.Empty<DashboardOrder>(),
        RecentCustomers = Array.Empty<DashboardCustomer>(),
    };
}
