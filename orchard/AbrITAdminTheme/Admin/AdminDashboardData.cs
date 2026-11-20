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

    /// <summary>
    /// True when the SMS/failed-payment metrics come from a real source.
    /// The dashboard hides those KPI cards when false instead of rendering
    /// permanently-unavailable placeholders (audit UI-8).
    /// </summary>
    public bool SmsMetricsAvailable { get; init; }

    /// <summary>True when recent admin activity is available from the audit
    /// log of the canonical commerce application.</summary>
    public bool RecentActivityAvailable { get; init; }

    /// <summary>Set when the whole commerce data source is unreachable — the
    /// dashboard renders ONE notice instead of eight identical error cards.</summary>
    public bool Unavailable { get; init; }
    public string UnavailableReason { get; init; } = "";

    public IReadOnlyList<DashboardOrder> RecentOrders { get; init; } = [];
    public IReadOnlyList<DashboardTransaction> RecentTransactions { get; init; } = [];
    public IReadOnlyList<DashboardActivity> RecentActivity { get; init; } = [];
}

public sealed record DashboardOrder(string Id, string Title, string Status, string AmountToman, string? Customer, string Created);
public sealed record DashboardTransaction(string Ref, string? OrderNumber, string Gateway, string AmountToman, string Status, string Created);
public sealed record DashboardActivity(string Actor, string Action, string Target, string Created);
