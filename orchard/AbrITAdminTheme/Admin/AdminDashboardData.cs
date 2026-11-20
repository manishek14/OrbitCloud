namespace AbrITAdminTheme.Admin;

public interface IAdminDashboardDataProvider
{
    Task<AdminDashboardData> GetAsync(CancellationToken cancellationToken);
}

public sealed class AdminDashboardData
{
    public string Customers { get; init; } = "—";
    public string Orders { get; init; } = "—";
    public string PendingOrders { get; init; } = "—";
    public string ActiveServices { get; init; } = "دادهٔ معتبر موجود نیست";
    public string PaymentAttempts { get; init; } = "—";
    public string FailedPayments { get; init; } = "—";
    public string SmsQueue { get; init; } = "—";
    public string FailedSms { get; init; } = "—";
    public string BackgroundJobs { get; init; } = "—";
    public string DriveConfiguration { get; init; } = "وضعیت بررسی نشده";
    public bool RegistrationDatesAvailable { get; init; }

    /// <summary>
    /// True when the SMS/failed-payment metrics come from a real source.
    /// The dashboard hides those KPI cards when false instead of rendering
    /// permanently-unavailable placeholders (audit UI-8).
    /// </summary>
    public bool SmsMetricsAvailable { get; init; }

    /// <summary>Set when the whole commerce data source is unreachable — the
    /// dashboard renders ONE notice instead of eight identical error cards.</summary>
    public bool Unavailable { get; init; }
    public string UnavailableReason { get; init; } = "";

    public IReadOnlyList<DashboardCustomer> RecentCustomers { get; init; } = [];
    public IReadOnlyList<DashboardOrder> RecentOrders { get; init; } = [];
}

public sealed record DashboardCustomer(string UserName, string? Email);
public sealed record DashboardOrder(string Id, string Title, string Status, string Created);
