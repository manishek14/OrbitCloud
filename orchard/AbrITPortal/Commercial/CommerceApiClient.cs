// ============================================================================
// CommerceApiClient — the documented server-to-server contract between the
// real Orchard Core administration and the Next.js commerce application.
//
// The Next.js application (customer portal + commerce APIs) is the CANONICAL
// OWNER of all business records: customers, orders, payments/transactions,
// subscriptions, Drive accounts, support tickets and the authoritative
// pricing catalog (src/lib/commerce/catalog.ts). Orchard's AbrIT business
// administration reads those same records through the Next.js admin API —
// there is NO second database of customers or orders inside Orchard.
//
// Authentication: the shared service secret (AbrIT:CommerceApi:ServiceToken,
// mirroring ABRIT_SERVICE_TOKEN in the Next.js app) is sent as the
// X-Abrit-Service-Token header and is validated server-side by the Next.js
// API in constant time. The secret is never exposed to browsers and must be
// at least 16 characters; when it is missing, the client reports
// IsNotConfigured and the admin pages show an honest "not configured" state.
// ============================================================================

using System.Text.Json;
using System.Net.Http.Json;

namespace AbrITPortal.Commercial;

public sealed class CommerceApiOptions
{
    /// <summary>Base URL of the Next.js application (default same-host).</summary>
    public string BaseUrl { get; set; } = "http://127.0.0.1:3000";
    /// <summary>Shared service secret (ABRIT_SERVICE_TOKEN). Required, min 16 chars.</summary>
    public string ServiceToken { get; set; } = string.Empty;
    public int TimeoutSeconds { get; set; } = 15;
}

public sealed class CommerceApiException : Exception
{
    public int? StatusCode { get; }
    public CommerceApiException(string message, int? statusCode = null) : base(message)
    {
        StatusCode = statusCode;
    }
}

public sealed record CommerceTotals(
    int Customers, int ActiveSubscriptions, int NewOrders, int PendingPayments,
    long ConfirmedRevenueToman, int ActiveDriveAccounts, int PendingTickets)
{
    /// <summary>Recent orders / transactions / admin activity carried by the
    /// same dashboard payload. Optional: older portal builds omit them.</summary>
    public IReadOnlyList<CommerceRecentOrder>? RecentOrders { get; init; }
    public IReadOnlyList<CommerceRecentTransaction>? RecentTransactions { get; init; }
    public IReadOnlyList<CommerceRecentActivity>? RecentActivity { get; init; }
}

public sealed record CommerceRecentOrder(
    string Id, string OrderNumber, string Status, long TotalToman, string CreatedAt, string? CustomerName);

public sealed record CommerceRecentTransaction(
    string Ref, string? OrderNumber, string Gateway, long AmountToman, string Status, string CreatedAt);

public sealed record CommerceRecentActivity(
    string ActorLabel, string Action, string EntityType, string CreatedAt);

public sealed record CommerceCustomer(
    string Id, string Email, string? Name, string? Mobile, string? Company, string Status,
    string CreatedAt, string? LastLoginAt, int OrderCount, long PaidTotalToman,
    bool HasDrive, string? ActiveSubscription);

/// <summary>Paginated customer page — the envelope returned by the portal's
/// GET api/admin/customers (items + page + pageSize + total + totalPages).
/// A legacy bare array is tolerated for backward compatibility.</summary>
public sealed record CommerceCustomerPage(
    IReadOnlyList<CommerceCustomer> Items, int Page, int PageSize, int Total, int TotalPages);

public sealed record CommerceOrder(
    string Id, string OrderNumber, string Status, int ItemCount, long TotalToman,
    string CreatedAt, string? PaidAt, string? CustomerName, string? CustomerEmail);

public sealed record CommerceTransaction(
    string Id, string Ref, string OrderNumber, string Gateway, long AmountToman,
    string Status, string CreatedAt, string? FinalizedAt);

public sealed record CommerceSubscriptionRow(
    string Id, string PackageNameFa, int Months, int Users, int Endpoints, string Status,
    string StartsAt, string ExpiresAt, long PriceTotalToman);

public sealed record CommerceDriveRow(
    string Id, string CustomerName, string CustomerEmail, string NcUsername, string PlanNameFa,
    long QuotaBytes, string Status, string ProvisionedAt, string? LastSyncedAt, int EventCount);

public sealed record CommerceTicketRow(
    string Id, string Number, string Subject, string Status, string Priority, string UpdatedAt, string? CustomerName);

public sealed record CommerceReport(
    int TotalPaidOrders, long TotalRevenueToman,
    IReadOnlyList<CommerceRevenueMonth> RevenueByMonth,
    IReadOnlyList<CommerceStatusCount> OrdersByStatus,
    IReadOnlyList<CommercePlanCount> PlanDistribution);

public sealed record CommerceRevenueMonth(string Month, long TotalToman, int OrderCount);
public sealed record CommerceStatusCount(string Status, int Count);
public sealed record CommercePlanCount(string PackageNameFa, int Count);

public sealed record CommercePlanRow(
    string Code, string NameFa, long MonthlyPriceToman, int IncludedUsers, int IncludedEndpoints,
    long DriveQuotaBytes, long ExtraUserFeeTomanPerMonth, long ExtraEndpointFeeTomanPerMonth,
    string SlaLabelFa, string SupportHoursFa, bool Featured, string NameEn, string AudienceFa,
    int Order, bool Orderable, int IncludedServers, int IncludedSites, int IncludedNetworkDevices,
    string SlaDetailFa, string? VpsFa, string OnSiteFa, IReadOnlyList<string> BenefitsFa,
    bool Active, int Revision);

public sealed record CommerceContractRow(
    int Months, double DiscountRate, double OnboardingRate, string LabelFa,
    string DiscountLabelFa, string OnboardingLabelFa, string? NoteFa,
    bool RequiresBusinessApproval, bool Active, int Revision);

public sealed class CommerceApiClient
{
    private readonly HttpClient _http;
    private readonly CommerceApiOptions _options;

    public CommerceApiClient(HttpClient http, Microsoft.Extensions.Options.IOptions<CommerceApiOptions> options)
    {
        _options = options.Value;
        _http = http;
        _http.BaseAddress = new Uri(_options.BaseUrl.TrimEnd('/') + "/");
        _http.Timeout = TimeSpan.FromSeconds(Math.Clamp(_options.TimeoutSeconds, 3, 60));
        if (!string.IsNullOrWhiteSpace(_options.ServiceToken))
        {
            _http.DefaultRequestHeaders.Add("X-Abrit-Service-Token", _options.ServiceToken);
        }
    }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_options.BaseUrl)
        && !string.IsNullOrWhiteSpace(_options.ServiceToken)
        && _options.ServiceToken.Trim().Length >= 16;

    // ---- JSON helpers --------------------------------------------------------

    private static string? Str(JsonElement e, string prop) =>
        e.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static int Int(JsonElement e, string prop) =>
        e.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : 0;
    private static long Long(JsonElement e, string prop) =>
        e.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt64() : 0;
    private static bool True(JsonElement e, string prop) =>
        e.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.True;
    private static double Dbl(JsonElement e, string prop) =>
        e.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;

    private async Task<JsonElement> GetJsonAsync(string path, CancellationToken ct)
    {
        if (!IsConfigured)
        {
            throw new CommerceApiException("Commerce API is not configured (AbrIT:CommerceApi:BaseUrl / ServiceToken).");
        }
        using var response = await _http.GetAsync(path, ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new CommerceApiException($"Commerce API {path} returned {(int)response.StatusCode}.", (int)response.StatusCode);
        }
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
        return doc.RootElement.Clone();
    }

    // ---- Typed fetchers ------------------------------------------------------

    public async Task<CommerceTotals?> GetTotalsAsync(CancellationToken ct = default)
    {
        var root = await GetJsonAsync("api/admin/dashboard", ct);
        if (!root.TryGetProperty("totals", out var t) || t.ValueKind != JsonValueKind.Object) return null;
        return new CommerceTotals(
            Int(t, "customers"), Int(t, "activeSubscriptions"), Int(t, "newOrders"),
            Int(t, "pendingPayments"), Long(t, "confirmedRevenueToman"),
            Int(t, "activeDriveAccounts"), Int(t, "pendingTickets"))
        {
            RecentOrders = EnumerateArray(root, "recentOrders", e => new CommerceRecentOrder(
                Str(e, "id") ?? "", Str(e, "orderNumber") ?? "", Str(e, "status") ?? "",
                Long(e, "totalToman"), Str(e, "createdAt") ?? "", Str(e, "customerName"))),
            RecentTransactions = EnumerateArray(root, "recentTransactions", e => new CommerceRecentTransaction(
                Str(e, "ref") ?? "", Str(e, "orderNumber"), Str(e, "gateway") ?? "",
                Long(e, "amountToman"), Str(e, "status") ?? "", Str(e, "createdAt") ?? "")),
            RecentActivity = EnumerateArray(root, "recentActivity", e => new CommerceRecentActivity(
                Str(e, "actorLabel") ?? "", Str(e, "action") ?? "", Str(e, "entityType") ?? "",
                Str(e, "createdAt") ?? "")),
        };
    }

    public async Task<CommerceCustomerPage> GetCustomersAsync(string? query = null, int page = 1, int pageSize = 50, CancellationToken ct = default)
    {
        var safePage = Math.Max(1, page);
        var safeSize = Math.Clamp(pageSize, 1, 200);
        var path = $"api/admin/customers?page={safePage}&pageSize={safeSize}";
        if (!string.IsNullOrEmpty(query)) path += $"&query={Uri.EscapeDataString(query)}";
        var root = await GetJsonAsync(path, ct);
        return ParseCustomerPage(root);
    }

    public async Task<CommerceCustomer?> GetCustomerAsync(string id, CancellationToken ct = default)
    {
        JsonElement root;
        try
        {
            root = await GetJsonAsync($"api/admin/customers/{Uri.EscapeDataString(id)}", ct);
        }
        catch (CommerceApiException ex) when (ex.StatusCode == 404)
        {
            // Unknown customer → a clean 404 page, not an error page.
            return null;
        }
        if (root.ValueKind != JsonValueKind.Object) return null;
        return new CommerceCustomer(
            Str(root, "id") ?? "", Str(root, "email") ?? "", Str(root, "name"), Str(root, "mobile"), Str(root, "company"),
            Str(root, "status") ?? "", Str(root, "createdAt") ?? "", Str(root, "lastLoginAt"),
            Int(root, "orderCount"), Long(root, "paidTotalToman"), True(root, "hasDrive"), Str(root, "activeSubscription"));
    }

    /// <summary>Accepts the current {items,…} envelope and the legacy bare
    /// array so a CMS update never hard-breaks against an older portal.</summary>
    private static CommerceCustomerPage ParseCustomerPage(JsonElement root)
    {
        JsonElement items = default;
        var page = 1;
        var pageSize = 0;
        var total = 0;
        var totalPages = 1;

        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("items", out var envelope) && envelope.ValueKind == JsonValueKind.Array)
        {
            items = envelope;
            page = Int(root, "page");
            pageSize = Int(root, "pageSize");
            total = Int(root, "total");
            totalPages = Math.Max(1, Int(root, "totalPages"));
        }
        else if (root.ValueKind == JsonValueKind.Array)
        {
            items = root;
            total = root.GetArrayLength();
        }

        var list = new List<CommerceCustomer>();
        if (items.ValueKind == JsonValueKind.Array)
        {
            foreach (var e in items.EnumerateArray())
            {
                list.Add(new CommerceCustomer(
                    Str(e, "id") ?? "", Str(e, "email") ?? "", Str(e, "name"), Str(e, "mobile"), Str(e, "company"),
                    Str(e, "status") ?? "", Str(e, "createdAt") ?? "", Str(e, "lastLoginAt"),
                    Int(e, "orderCount"), Long(e, "paidTotalToman"), True(e, "hasDrive"), Str(e, "activeSubscription")));
            }
        }
        return new CommerceCustomerPage(list, Math.Max(1, page), pageSize, total, Math.Max(1, totalPages));
    }

    public async Task<IReadOnlyList<CommerceOrder>> GetOrdersAsync(CancellationToken ct = default)
    {
        var root = await GetJsonAsync("api/admin/orders", ct);
        return EnumerateArray(root, e => new CommerceOrder(
            Str(e, "id") ?? "", Str(e, "orderNumber") ?? "", Str(e, "status") ?? "",
            Int(e, "itemCount"), Long(e, "totalToman"), Str(e, "createdAt") ?? "",
            Str(e, "paidAt"), Str(e, "customerName"), Str(e, "customerEmail")));
    }

    public async Task<IReadOnlyList<CommerceTransaction>> GetTransactionsAsync(CancellationToken ct = default)
    {
        var root = await GetJsonAsync("api/admin/payments", ct);
        return EnumerateArray(root, e => new CommerceTransaction(
            Str(e, "id") ?? "", Str(e, "ref") ?? "", Str(e, "orderNumber") ?? "—",
            Str(e, "gateway") ?? "", Long(e, "amountToman"), Str(e, "status") ?? "",
            Str(e, "createdAt") ?? "", Str(e, "finalizedAt")));
    }

    public async Task<IReadOnlyList<CommerceSubscriptionRow>> GetSubscriptionsAsync(CancellationToken ct = default)
    {
        var root = await GetJsonAsync("api/admin/subscriptions", ct);
        return EnumerateArray(root, e => new CommerceSubscriptionRow(
            Str(e, "id") ?? "", Str(e, "packageNameFa") ?? "", Int(e, "months"), Int(e, "users"),
            Int(e, "endpoints"), Str(e, "status") ?? "", Str(e, "startsAt") ?? "",
            Str(e, "expiresAt") ?? "", Long(e, "priceTotalToman")));
    }

    public async Task<IReadOnlyList<CommerceDriveRow>> GetDriveAccountsAsync(CancellationToken ct = default)
    {
        var root = await GetJsonAsync("api/admin/drive", ct);
        return EnumerateArray(root, e =>
        {
            string? customerName = null, customerEmail = null;
            if (e.TryGetProperty("customer", out var c) && c.ValueKind == JsonValueKind.Object)
            {
                customerName = Str(c, "name");
                customerEmail = Str(c, "email");
            }
            return new CommerceDriveRow(
                Str(e, "id") ?? "", customerName, customerEmail, Str(e, "ncUsername") ?? "",
                Str(e, "planNameFa") ?? "", Long(e, "quotaBytes"), Str(e, "status") ?? "",
                Str(e, "provisionedAt") ?? "", Str(e, "lastSyncedAt"), Int(e, "eventCount"));
        });
    }

    public async Task<IReadOnlyList<CommerceTicketRow>> GetTicketsAsync(CancellationToken ct = default)
    {
        var root = await GetJsonAsync("api/admin/tickets", ct);
        return EnumerateArray(root, e => new CommerceTicketRow(
            Str(e, "id") ?? "", Str(e, "number") ?? "", Str(e, "subject") ?? "", Str(e, "status") ?? "",
            Str(e, "priority") ?? "", Str(e, "updatedAt") ?? "", Str(e, "customerName")));
    }

    public async Task<CommerceReport?> GetReportAsync(CancellationToken ct = default)
    {
        var root = await GetJsonAsync("api/admin/reports", ct);
        var revenue = EnumerateArray(root, "revenueByMonth", e => new CommerceRevenueMonth(Str(e, "month") ?? "", Long(e, "totalToman"), Int(e, "orderCount")));
        var statuses = EnumerateArray(root, "ordersByStatus", e => new CommerceStatusCount(Str(e, "status") ?? "", Int(e, "count")));
        var plans = EnumerateArray(root, "planDistribution", e => new CommercePlanCount(Str(e, "packageNameFa") ?? "", Int(e, "count")));
        return new CommerceReport(Int(root, "totalPaidOrders"), Long(root, "totalRevenueToman"), revenue, statuses, plans);
    }

    public async Task<(IReadOnlyList<CommercePlanRow> Plans, IReadOnlyList<CommerceContractRow> Contracts)?> GetCatalogAsync(CancellationToken ct = default)
    {
        var plansRoot = await GetJsonAsync("api/admin/pricing/plans", ct);
        var contractsRoot = await GetJsonAsync("api/admin/pricing/contracts", ct);
        var plans = EnumerateArray(plansRoot, e => new CommercePlanRow(
            Str(e, "code") ?? "", Str(e, "nameFa") ?? "", Long(e, "monthlyPriceToman"),
            Int(e, "includedUsers"), Int(e, "includedEndpoints"), Long(e, "driveQuotaBytes"),
            Long(e, "extraUserFeeTomanPerMonth"), Long(e, "extraEndpointFeeTomanPerMonth"),
            Str(e, "slaLabelFa") ?? "", Str(e, "supportHoursFa") ?? "", True(e, "featured"),
            Str(e, "nameEn") ?? "", Str(e, "audienceFa") ?? "", Int(e, "order"), True(e, "orderable"),
            Int(e, "includedServers"), Int(e, "includedSites"), Int(e, "includedNetworkDevices"),
            Str(e, "slaDetailFa") ?? "", Str(e, "vpsFa"), Str(e, "onSiteFa") ?? "",
            EnumerateArray(e, "benefitsFa", b => b.GetString() ?? ""), True(e, "active"), Int(e, "revision")));
        var contracts = EnumerateArray(contractsRoot, e => new CommerceContractRow(
            Int(e, "months"), Dbl(e, "discountRate"), Dbl(e, "onboardingRate"),
            Str(e, "labelFa") ?? "", Str(e, "discountLabelFa") ?? "", Str(e, "onboardingLabelFa") ?? "",
            Str(e, "noteFa"), True(e, "requiresBusinessApproval"), True(e, "active"), Int(e, "revision")));
        return (plans, contracts);
    }

    public async Task SendPricingAsync(string kind, string? id, HttpMethod method, object body, CancellationToken ct = default)
    {
        if (!IsConfigured) throw new CommerceApiException("اتصال به سرویس تجاری پیکربندی نشده است.");
        var path = $"api/admin/pricing/{kind}" + (id is null ? "" : $"/{Uri.EscapeDataString(id)}");
        using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) };
        using var response = await _http.SendAsync(request, ct);
        if (response.IsSuccessStatusCode) return;
        var message = "ثبت تغییرات ناموفق بود.";
        try
        {
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            message = Str(json.RootElement.GetProperty("error"), "message") ?? message;
        }
        catch (JsonException) { }
        throw new CommerceApiException(message, (int)response.StatusCode);
    }

    private static IReadOnlyList<T> EnumerateArray<T>(JsonElement root, Func<JsonElement, T> map)
    {
        var list = new List<T>();
        if (root.ValueKind == JsonValueKind.Array)
        {
            foreach (var e in root.EnumerateArray()) list.Add(map(e));
        }
        return list;
    }

    private static IReadOnlyList<T> EnumerateArray<T>(JsonElement root, string property, Func<JsonElement, T> map)
    {
        var list = new List<T>();
        if (root.TryGetProperty(property, out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var e in arr.EnumerateArray()) list.Add(map(e));
        }
        return list;
    }
}
