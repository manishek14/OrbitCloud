using System.Text.Json.Nodes;
using AbrITPortal.Commercial;
using AbrITPortal.Drive;
using AbrITPortal.Notifications;
using AbrITPortal.Payments;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using OrchardCore.Admin;
using OrchardCore.BackgroundTasks;
using OrchardCore.ContentManagement;
using OrchardCore.ContentManagement.Records;
using OrchardCore.Users;
using OrchardCore.Users.Models;
using YesSql;

namespace AbrITPortal.Areas.Admin.Controllers;

[Admin]
[Authorize(Roles = "Administrator")]
[Route("Admin/AbrIT")]
public sealed class AbrITOperationsAdminController(
    UserManager<IUser> users,
    YesSql.ISession session,
    IPaymentStore payments,
    ISmsOutboxStore sms,
    IEnumerable<ISmsProviderV2> smsProviders,
    IPaymentProviderRegistry paymentProviders,
    IEnumerable<IBackgroundTask> backgroundTasks,
    DriveStatusService drive) : Controller
{
    private const int PageSize = 25;

    [HttpGet("Customers")]
    public async Task<IActionResult> Customers(string? q, int page = 1)
    {
        var rows = new List<CustomerAdminRow>();
        foreach (var account in await users.GetUsersInRoleAsync("Customer"))
        {
            rows.Add(await ToCustomerRowAsync(account));
        }

        var filter = q?.Trim();
        if (!string.IsNullOrEmpty(filter))
        {
            rows = rows.Where(row =>
                    Contains(row.UserName, filter)
                    || Contains(row.Email, filter)
                    || Contains(row.Mobile, filter))
                .ToList();
        }

        var total = rows.Count;
        var currentPage = Math.Max(1, page);
        return OperationsPage("Customers", "مشتریان", "حساب‌های دارای نقش مشتری؛ اطلاعات محرمانهٔ ورود نمایش داده نمی‌شود.",
            customers: rows.OrderBy(row => row.UserName, StringComparer.CurrentCultureIgnoreCase)
                .Skip((currentPage - 1) * PageSize).Take(PageSize).ToArray(),
            query: filter, pageNumber: currentPage, totalCount: total);
    }

    [HttpGet("Customers/{id}")]
    public async Task<IActionResult> Customer(string id)
    {
        var account = await users.FindByIdAsync(id);
        if (account is null || !await users.IsInRoleAsync(account, "Customer"))
        {
            return NotFound();
        }

        var orders = await session.Query<ContentItem, ContentItemIndex>(
                item => item.ContentType == "AbrITOrder" && item.Published && item.Owner == id)
            .OrderByDescending(item => item.CreatedUtc)
            .Take(100)
            .ListAsync();
        var orderRows = new List<OrderAdminRow>();
        foreach (var order in orders)
        {
            orderRows.Add(await ToOrderRowAsync(order));
        }
        return OperationsPage("CustomerDetails", "جزئیات مشتری", "وضعیت حساب و سفارش‌های منتشرشدهٔ منتسب به این شناسه.",
            customer: await ToCustomerRowAsync(account),
            orders: orderRows);
    }

    [HttpGet("Orders")]
    public async Task<IActionResult> Orders(string? q, int page = 1)
    {
        var all = await session.Query<ContentItem, ContentItemIndex>(
                item => item.ContentType == "AbrITOrder" && item.Published)
            .OrderByDescending(item => item.CreatedUtc)
            .Take(500)
            .ListAsync();
        var filter = q?.Trim();
        var rows = new List<OrderAdminRow>();
        foreach (var item in all)
        {
            var row = await ToOrderRowAsync(item);
            if (string.IsNullOrEmpty(filter)
                || Contains(row.Id, filter)
                || Contains(row.Title, filter)
                || Contains(row.Status, filter)
                || Contains(row.OwnerId, filter)
                || Contains(row.CustomerName, filter)
                || Contains(row.CustomerEmail, filter))
            {
                rows.Add(row);
            }
        }
        var currentPage = Math.Max(1, page);
        return OperationsPage("Orders", "سفارش‌ها", "سفارش‌های منتشرشده؛ حداکثر ۵۰۰ رکورد اخیر برای این فهرست خوانده می‌شود.",
            orders: rows.Skip((currentPage - 1) * PageSize).Take(PageSize).ToArray(),
            query: filter, pageNumber: currentPage, totalCount: rows.Count);
    }

    [HttpGet("Orders/{id}")]
    public async Task<IActionResult> Order(string id)
    {
        var order = await session.Query<ContentItem, ContentItemIndex>(
                item => item.ContentType == "AbrITOrder" && item.Published && item.ContentItemId == id)
            .FirstOrDefaultAsync();
        return order is null
            ? NotFound()
            : OperationsPage("OrderDetails", "جزئیات سفارش", "اطلاعات موجود در رکورد منتشرشدهٔ سفارش.",
                order: await ToOrderRowAsync(order));
    }

    [HttpGet("Provisioning")]
    public async Task<IActionResult> Provisioning()
    {
        var orders = await session.Query<ContentItem, ContentItemIndex>(
                item => item.ContentType == "AbrITOrder" && item.Published)
            .OrderByDescending(item => item.CreatedUtc)
            .Take(100)
            .ListAsync();
        return OperationsPage("Provisioning", "راه‌اندازی سرویس", "نمای سفارش‌ها و وضعیت واقعی provisioning، در صورت ثبت در رکوردها.",
            orders: await ToOrderRowsAsync(orders),
            statusMessage: "در مدل فعلی، سابقهٔ عملیات provisioning یا وضعیت ارائه‌دهنده ذخیره نمی‌شود. وضعیت‌های ثبت‌شدهٔ سفارش نمایش داده می‌شوند؛ هیچ عملیات provisioning از این صفحه اجرا نمی‌شود.");
    }

    [HttpGet("Drive")]
    public async Task<IActionResult> DriveStatus(int page = 1, CancellationToken cancellationToken = default)
    {
        var allAccounts = new List<CustomerAdminRow>();
        foreach (var account in await users.GetUsersInRoleAsync("Customer"))
        {
            allAccounts.Add(await ToCustomerRowAsync(account));
        }
        var accounts = allAccounts.OrderBy(row => row.UserName, StringComparer.CurrentCultureIgnoreCase).ToArray();
        var currentPage = Math.Max(1, page);
        const int drivePageSize = 5;
        var selected = accounts.Skip((currentPage - 1) * drivePageSize).Take(drivePageSize).ToArray();
        var driveRows = new List<DriveAdminRow>();
        foreach (var account in selected)
        {
            var status = await drive.GetStatusAsync(account.Id, cancellationToken);
            var relatedOrder = await session.Query<ContentItem, ContentItemIndex>(
                    item => item.ContentType == "AbrITOrder" && item.Published && item.Owner == account.Id)
                .OrderByDescending(item => item.CreatedUtc)
                .FirstOrDefaultAsync();
            driveRows.Add(new DriveAdminRow(
                account.Id,
                account.UserName,
                account.Email,
                relatedOrder?.ContentItemId,
                status.State.ToString(),
                status.Detail,
                status.UsedBytes,
                status.TotalBytes));
        }

        return OperationsPage("Drive", "AbrIT Drive", "وضعیت پیکربندی integration؛ این بررسی به معنی اتصال موفق یا provisioning حساب‌ها نیست.",
            statusMessage: (drive.IsConfigured
                ? "اعتبارنامه و آدرس در تنظیمات برنامه پیکربندی شده‌اند. وضعیت واقعی پوشهٔ هر مشتری و تاریخچهٔ provisioning در یک فهرست مدیریتی پایدار ثبت نمی‌شود."
                : "اتصال AbrIT Drive در تنظیمات برنامه پیکربندی نشده است. هیچ provisioning از این صفحه انجام نمی‌شود.")
                + " وضعیت‌های زیر با سرویس موجود بررسی می‌شوند؛ هیچ عملیات نوشتنی اجرا نمی‌شود.",
            drives: driveRows,
            pageNumber: currentPage,
            totalCount: accounts.Length,
            pageSize: drivePageSize);
    }

    [HttpGet("Reports")]
    public async Task<IActionResult> Reports(CancellationToken cancellationToken)
    {
        var customerCount = (await users.GetUsersInRoleAsync("Customer")).Count;
        var orderCount = await session.Query<ContentItem, ContentItemIndex>(
            item => item.ContentType == "AbrITOrder" && item.Published).CountAsync();
        var recentPayments = await payments.ListAsync("Default", 100, cancellationToken);
        var recentSms = await sms.ListAsync("Default", 100, cancellationToken);
        var report = new[]
        {
            new ReportAdminRow("مشتریان ثبت‌شده", customerCount.ToString("N0"), "تعداد حساب‌های دارای نقش Customer."),
            new ReportAdminRow("سفارش‌های منتشرشده", orderCount.ToString("N0"), "تعداد رکوردهای AbrITOrder منتشرشده."),
            new ReportAdminRow("پرداخت‌های ناموفق", recentPayments.Count(row => row.Status is PaymentAttemptStatus.Failed
                or PaymentAttemptStatus.Declined or PaymentAttemptStatus.Expired).ToString("N0"), "از حداکثر ۱۰۰ تلاش اخیر موجود در مخزن."),
            new ReportAdminRow("پیامک‌های ناموفق", recentSms.Count(row => row.Status is SmsMessageStatus.Failed
                or SmsMessageStatus.DeadLetter).ToString("N0"), "از حداکثر ۱۰۰ پیام اخیر موجود در مخزن.")
        };
        return OperationsPage("Reports", "گزارش‌ها", "گزارش‌های مبتنی بر داده‌های واقعی موجود؛ آمار مالی یا رویدادهای ثبت‌نشده ساخته نمی‌شوند.",
            reports: report);
    }

    [HttpGet("Settings")]
    public IActionResult Settings()
    {
        return OperationsPage("Settings", "تنظیمات سامانه", "ورودی AbrIT برای تنظیمات موجود؛ مقادیر محرمانه در این صفحه نمایش داده نمی‌شوند.",
            statusMessage: "ویرایش تنظیمات اجرایی AbrIT در این صفحه پیاده‌سازی نشده است. از صفحهٔ تنظیمات بومی Orchard برای مدیریت تنظیمات موجود استفاده کنید.");
    }

    private async Task<CustomerAdminRow> ToCustomerRowAsync(IUser account)
    {
        var user = account as User;
        return new CustomerAdminRow(
            await users.GetUserIdAsync(account),
            await users.GetUserNameAsync(account) ?? "—",
            await users.GetEmailAsync(account),
            user?.PhoneNumber,
            user?.EmailConfirmed,
            user?.PhoneNumberConfirmed,
            user?.IsEnabled);
    }

    private async Task<OrderAdminRow[]> ToOrderRowsAsync(IEnumerable<ContentItem> orders)
    {
        var rows = new List<OrderAdminRow>();
        foreach (var order in orders)
        {
            rows.Add(await ToOrderRowAsync(order));
        }
        return rows.ToArray();
    }

    private async Task<OrderAdminRow> ToOrderRowAsync(ContentItem order)
    {
        var fields = order.Content["AbrITOrder"];
        var customer = string.IsNullOrWhiteSpace(order.Owner) ? null : await users.FindByIdAsync(order.Owner);
        return new OrderAdminRow(
            order.ContentItemId,
            string.IsNullOrWhiteSpace(order.DisplayText) ? order.ContentItemId : order.DisplayText,
            order.Owner,
            customer is null ? null : await users.GetUserNameAsync(customer),
            customer is null ? null : await users.GetEmailAsync(customer),
            fields?["Status"]?["Text"]?.ToString() ?? "در انتظار",
            order.CreatedUtc.ToString(),
            ReadField(fields, "PlanCode", "Plan"),
            ReadField(fields, "ContractMonths"),
            ReadField(fields, "SelectedUsers", "UserCount"),
            ReadField(fields, "Price", "TotalAmount"),
            ReadField(fields, "PaymentStatus"),
            ReadField(fields, "ProvisioningStatus"),
            ReadField(fields, "ProviderState"),
            ReadField(fields, "LastOperation"),
            ReadField(fields, "SanitizedError"));
    }

    private static string? ReadField(JsonNode? fields, params string[] names)
    {
        foreach (var name in names)
        {
            var value = fields?[name];
            if (value is null)
            {
                continue;
            }

            var text = value is JsonObject fieldObject
                ? fieldObject["Text"]?.ToString() ?? fieldObject["Value"]?.ToString() ?? value.ToString()
                : value.ToString();
            if (!string.IsNullOrWhiteSpace(text))
            {
                return text;
            }
        }

        return null;
    }

    private IActionResult OperationsPage(
        string page,
        string title,
        string description,
        IReadOnlyList<CustomerAdminRow>? customers = null,
        IReadOnlyList<OrderAdminRow>? orders = null,
        CustomerAdminRow? customer = null,
        OrderAdminRow? order = null,
        IReadOnlyList<ReportAdminRow>? reports = null,
        string? statusMessage = null,
        string? query = null,
        int pageNumber = 1,
        int totalCount = 0,
        int pageSize = PageSize,
        IReadOnlyList<DriveAdminRow>? drives = null)
    {
        var model = new OperationsAdminPageModel(
            page, title, description, customers ?? [], orders ?? [], customer, order,
            reports ?? [], statusMessage, query, pageNumber, totalCount, pageSize,
            smsProviders.Select(provider => new ProviderAdminRow(provider.Code, provider.IsEnabled)).ToArray(),
            paymentProviders.GetAll().Select(provider => new ProviderAdminRow(provider.Code, provider.IsEnabled)).ToArray(),
            backgroundTasks.Select(task => task.GetType().Name).OrderBy(name => name).ToArray(),
            drives ?? []);
        return View("~/Areas/Admin/Views/Operations/Index.cshtml", model);
    }

    private static bool Contains(string? value, string filter) =>
        value?.Contains(filter, StringComparison.OrdinalIgnoreCase) == true;
}

public sealed record CustomerAdminRow(
    string Id,
    string UserName,
    string? Email,
    string? Mobile,
    bool? EmailVerified,
    bool? MobileVerified,
    bool? Enabled);

public sealed record OrderAdminRow(
    string Id,
    string Title,
    string OwnerId,
    string? CustomerName,
    string? CustomerEmail,
    string Status,
    string Created,
    string? Plan,
    string? ContractMonths,
    string? UserCount,
    string? Amount,
    string? PaymentStatus,
    string? ProvisioningStatus,
    string? ProviderState,
    string? LastOperation,
    string? SanitizedError);

public sealed record ReportAdminRow(string Label, string Value, string Description);
public sealed record ProviderAdminRow(string Code, bool Enabled);
public sealed record DriveAdminRow(string UserId, string UserName, string? Email, string? RelatedOrderId, string State, string? Detail, long? UsedBytes, long? TotalBytes);

public sealed record OperationsAdminPageModel(
    string Page,
    string Title,
    string Description,
    IReadOnlyList<CustomerAdminRow> Customers,
    IReadOnlyList<OrderAdminRow> Orders,
    CustomerAdminRow? Customer,
    OrderAdminRow? Order,
    IReadOnlyList<ReportAdminRow> Reports,
    string? StatusMessage,
    string? Query,
    int PageNumber,
    int TotalCount,
    int PageSize,
    IReadOnlyList<ProviderAdminRow> SmsProviders,
    IReadOnlyList<ProviderAdminRow> PaymentProviders,
    IReadOnlyList<string> BackgroundJobs,
    IReadOnlyList<DriveAdminRow> Drives);
