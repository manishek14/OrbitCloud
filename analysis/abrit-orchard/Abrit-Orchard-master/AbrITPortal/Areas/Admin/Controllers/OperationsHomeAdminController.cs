using AbrITPortal.Commercial;
using AbrITPortal.Drive;
using AbrITPortal.Notifications;
using AbrITPortal.Orders;
using AbrITPortal.Payments;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using OrchardCore.Admin;
using OrchardCore.ContentManagement;
using OrchardCore.ContentManagement.Records;
using OrchardCore.Users;
using OrchardCore.Users.Indexes;
using OrchardCore.Users.Models;
using YesSql;

namespace AbrITPortal.Areas.Admin.Controllers;

[Admin]
[Authorize(Roles = "Administrator")]
[Route("Admin/AbrIT")]
public sealed class OperationsHomeAdminController(
    ICommercialRulesService commercial,
    IServiceProvider services,
    IOptions<AbrITDriveOptions> drive,
    YesSql.ISession session,
    UserManager<IUser> users) : Controller
{
    [HttpGet("")]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var overview = await LoadOverviewAsync(ct);
        return View("~/Areas/Admin/Views/OperationsHome/Index.cshtml", overview);
    }

    [HttpGet("Customers")]
    public async Task<IActionResult> Customers(string? q, int page = 1, CancellationToken ct = default)
    {
        var accounts = await LoadCustomersAsync();
        var orders = await LoadOrdersAsync(ct);
        var rows = new List<AdminCustomerRow>(accounts.Count);

        foreach (var account in accounts)
        {
            var userId = await users.GetUserIdAsync(account);
            rows.Add(new AdminCustomerRow(
                userId,
                await users.GetUserNameAsync(account) ?? "",
                await users.GetEmailAsync(account) ?? "",
                await users.GetPhoneNumberAsync(account) ?? "",
                await users.IsEmailConfirmedAsync(account),
                await users.IsPhoneNumberConfirmedAsync(account),
                await users.IsLockedOutAsync(account),
                orders.Count(order => order.Owner == userId)));
        }

        var filtered = FilterCustomers(rows, q).OrderBy(row => row.UserName, StringComparer.OrdinalIgnoreCase).ToList();
        const int pageSize = 25;
        var pageCount = Math.Max(1, (int)Math.Ceiling(filtered.Count / (double)pageSize));
        page = Math.Clamp(page, 1, pageCount);
        var model = new AdminCustomersPage(filtered.Count, q, page, pageCount,
            filtered.Skip((page - 1) * pageSize).Take(pageSize).ToList());

        return View("~/Areas/Admin/Views/OperationsHome/Customers.cshtml", model);
    }

    [HttpGet("Customers/{id}")]
    public async Task<IActionResult> Customer(string id, CancellationToken ct)
    {
        var account = await users.FindByIdAsync(id);
        if (account is null || !await users.IsInRoleAsync(account, "Customer")) return NotFound();

        var userId = await users.GetUserIdAsync(account);
        var orders = (await LoadOrdersAsync(ct))
            .Where(order => order.Owner == userId)
            .Select(order => ToOrderRow(order))
            .ToList();

        var model = new AdminCustomerDetails(
            userId,
            await users.GetUserNameAsync(account) ?? "",
            await users.GetEmailAsync(account) ?? "",
            await users.GetPhoneNumberAsync(account) ?? "",
            await users.IsEmailConfirmedAsync(account),
            await users.IsPhoneNumberConfirmedAsync(account),
            await users.IsLockedOutAsync(account),
            orders);

        return View("~/Areas/Admin/Views/OperationsHome/Customer.cshtml", model);
    }

    [HttpGet("Orders")]
    public async Task<IActionResult> Orders(string? q, int page = 1, CancellationToken ct = default)
    {
        var accounts = await LoadCustomersAsync();
        var customerNames = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var account in accounts)
        {
            customerNames[await users.GetUserIdAsync(account)] = await users.GetUserNameAsync(account) ?? "";
        }

        var rows = (await LoadOrdersAsync(ct)).Select(order => ToOrderRow(order, customerNames)).ToList();
        if (!string.IsNullOrWhiteSpace(q))
        {
            rows = rows.Where(row =>
                Contains(row.OrderId, q) ||
                Contains(row.CustomerName, q) ||
                Contains(row.Service, q) ||
                Contains(row.Status, q)).ToList();
        }

        const int pageSize = 25;
        var pageCount = Math.Max(1, (int)Math.Ceiling(rows.Count / (double)pageSize));
        page = Math.Clamp(page, 1, pageCount);
        var model = new AdminOrdersPage(rows.Count, q, page, pageCount,
            rows.OrderByDescending(row => row.CreatedUtc).Skip((page - 1) * pageSize).Take(pageSize).ToList());
        return View("~/Areas/Admin/Views/OperationsHome/Orders.cshtml", model);
    }

    [HttpGet("Orders/{id}")]
    public async Task<IActionResult> Order(string id, CancellationToken ct)
    {
        var order = await session.Query<ContentItem, ContentItemIndex>(
            item => item.ContentType == "AbrITOrder" && item.Published && item.ContentItemId == id)
            .FirstOrDefaultAsync();
        if (order is null) return NotFound();

        var owner = order.Owner is null ? null : await users.FindByIdAsync(order.Owner);
        var customerName = owner is null ? "حساب کاربری در دسترس نیست" : await users.GetUserNameAsync(owner) ?? "—";
        var model = ToOrderRow(order, new Dictionary<string, string>
        {
            [order.Owner ?? ""] = customerName
        });
        return View("~/Areas/Admin/Views/OperationsHome/Order.cshtml", model);
    }

    [HttpGet("Provisioning")]
    public IActionResult Provisioning() => Section("راه‌اندازی سرویس",
        "رکورد یا صف پایدار راه‌اندازی سرویس متصل به سفارش وجود ندارد. وضعیت پرداخت به‌تنهایی به‌عنوان راه‌اندازی موفق تفسیر نمی‌شود.");

    [HttpGet("Drive")]
    public IActionResult Drive() => Section("AbrIT Drive",
        drive.Value.Enabled
            ? "اتصال Drive پیکربندی شده است؛ این سامانه endpoint فهرست مدیریتی تخصیص‌ها یا تاریخچهٔ راه‌اندازی ندارد."
            : "اتصال Drive در این tenant پیکربندی نشده است. وضعیت ساختگی یا اتصال به سرویس بیرونی نمایش داده نمی‌شود.");

    [HttpGet("Reports")]
    public async Task<IActionResult> Reports(CancellationToken ct)
    {
        var overview = await LoadOverviewAsync(ct);
        return View("~/Areas/Admin/Views/OperationsHome/Reports.cshtml", overview);
    }

    [HttpGet("Settings")]
    public IActionResult Settings() =>
        View("~/Areas/Admin/Views/OperationsHome/Section.cshtml",
            new AbrITOperationsSection("تنظیمات سامانه",
                "تنظیمات محرمانه در این صفحه نمایش داده نمی‌شوند. تنظیمات تجاری از بخش پلن‌ها و سایر تنظیمات از پنل بومی Orchard مدیریت می‌شوند."));

    private async Task<AbrITOperationsOverview> LoadOverviewAsync(CancellationToken ct)
    {
        var accounts = await LoadCustomersAsync();
        var customerNames = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var account in accounts)
        {
            customerNames[await users.GetUserIdAsync(account)] = await users.GetUserNameAsync(account) ?? "";
        }
        var orders = await LoadOrdersAsync(ct);
        var paymentStore = services.GetService<IPaymentStore>();
        var smsStore = services.GetService<ISmsOutboxStore>();
        var paymentAttempts = paymentStore is null
            ? null
            : await paymentStore.ListAsync("Default", 100, ct);
        var smsMessages = smsStore is null
            ? null
            : await smsStore.ListAsync("Default", 100, ct);
        var smsIr = services.GetServices<ISmsProviderV2>().FirstOrDefault(provider => provider.Code == "smsir");
        var rules = await commercial.GetAsync();

        return new AbrITOperationsOverview(
            accounts.Count,
            orders.Count,
            orders.Count(order => IsPending(Status(order))),
            orders.Count(order => Status(order) is "فعال" or "Active"),
            orders.Count(order => Status(order) is "تکمیل" or "Completed"),
            orders.OrderByDescending(order => order.CreatedUtc).Take(10)
                .Select(order => ToOrderRow(order, customerNames)).ToList(),
            paymentAttempts?.GroupBy(attempt => attempt.Status.ToString())
                .Select(group => new AdminStatusCount(group.Key, group.Count())).OrderBy(group => group.Status).ToList(),
            smsMessages?.GroupBy(message => message.Status.ToString())
                .Select(group => new AdminStatusCount(group.Key, group.Count())).OrderBy(group => group.Status).ToList(),
            paymentAttempts?.Count,
            smsMessages?.Count,
            paymentStore is PostgresPaymentStore,
            smsStore is PostgresSmsOutboxStore,
            smsIr?.IsEnabled == true,
            drive.Value.Enabled,
            rules.CommercialValuesApproved);
    }

    private async Task<List<ContentItem>> LoadOrdersAsync(CancellationToken ct) =>
        (await session.Query<ContentItem, ContentItemIndex>(item =>
                item.ContentType == "AbrITOrder" && item.Published)
            .OrderByDescending(item => item.CreatedUtc)
            .ListAsync()).ToList();

    private async Task<List<IUser>> LoadCustomersAsync()
    {
        var accounts = await session.Query<User, UserIndex>().ListAsync();
        var customers = new List<IUser>();
        foreach (var account in accounts)
        {
            if (await users.IsInRoleAsync(account, "Customer"))
                customers.Add(account);
        }
        return customers;
    }

    private static IEnumerable<AdminCustomerRow> FilterCustomers(IEnumerable<AdminCustomerRow> rows, string? query)
    {
        if (string.IsNullOrWhiteSpace(query)) return rows;
        return rows.Where(row =>
            Contains(row.UserName, query) ||
            Contains(row.Email, query) ||
            Contains(row.Mobile, query));
    }

    private static bool Contains(string? value, string query) =>
        value?.Contains(query, StringComparison.OrdinalIgnoreCase) == true;

    private static bool IsPending(string status) =>
        status is not ("فعال" or "Active" or "تکمیل" or "Completed" or "لغو" or "لغو شده" or "Cancelled");

    private static string Status(ContentItem item) =>
        item.Content["AbrITOrder"]?["Status"]?["Text"]?.ToString() ?? "در انتظار";

    private static AdminOrderRow ToOrderRow(ContentItem order, IReadOnlyDictionary<string, string>? customerNames = null)
    {
        var fields = order.Content["AbrITOrder"];
        return new AdminOrderRow(
            order.ContentItemId,
            order.Owner ?? "",
            order.Owner is not null && customerNames?.TryGetValue(order.Owner, out var name) == true ? name : "—",
            fields?["ServiceId"]?["Text"]?.ToString() ?? "—",
            fields?["Price"]?["Text"]?.ToString() ?? "—",
            Status(order),
            order.CreatedUtc);
    }

    private IActionResult Section(string title, string description) =>
        View("~/Areas/Admin/Views/OperationsHome/Section.cshtml", new AbrITOperationsSection(title, description));
}

public sealed record AbrITOperationsOverview(
    int TotalCustomers,
    int TotalOrders,
    int PendingOrders,
    int ActiveServices,
    int CompletedOrders,
    IReadOnlyList<AdminOrderRow> RecentOrders,
    IReadOnlyList<AdminStatusCount>? PaymentStatuses,
    IReadOnlyList<AdminStatusCount>? SmsStatuses,
    int? RecentPaymentAttempts,
    int? RecentSmsMessages,
    bool PaymentDurable,
    bool SmsDurable,
    bool SmsIrEnabled,
    bool DriveConfigured,
    bool CommercialApproved);

public sealed record AdminCustomerRow(
    string UserId,
    string UserName,
    string Email,
    string Mobile,
    bool EmailConfirmed,
    bool MobileConfirmed,
    bool IsLockedOut,
    int OrderCount);

public sealed record AdminCustomersPage(
    int TotalCount,
    string? Query,
    int Page,
    int PageCount,
    IReadOnlyList<AdminCustomerRow> Customers);

public sealed record AdminCustomerDetails(
    string UserId,
    string UserName,
    string Email,
    string Mobile,
    bool EmailConfirmed,
    bool MobileConfirmed,
    bool IsLockedOut,
    IReadOnlyList<AdminOrderRow> Orders);

public sealed record AdminOrdersPage(
    int TotalCount,
    string? Query,
    int Page,
    int PageCount,
    IReadOnlyList<AdminOrderRow> Orders);

public sealed record AdminOrderRow(
    string OrderId,
    string CustomerId,
    string CustomerName,
    string Service,
    string Price,
    string Status,
    DateTime? CreatedUtc);

public sealed record AdminStatusCount(string Status, int Count);

public sealed record AbrITOperationsSection(string Title, string Description);
