using AbrITAdminTheme.Admin;
using AbrITPortal.Drive;
using AbrITPortal.Notifications;
using AbrITPortal.Payments;
using Microsoft.AspNetCore.Identity;
using OrchardCore.BackgroundTasks;
using OrchardCore.ContentManagement;
using OrchardCore.ContentManagement.Records;
using OrchardCore.Users;
using OrchardCore.Users.Models;
using YesSql;

namespace AbrITPortal.Commercial;

public sealed class OperationsDashboardDataProvider(
    UserManager<IUser> users,
    YesSql.ISession session,
    IPaymentStore payments,
    ISmsOutboxStore sms,
    IEnumerable<IBackgroundTask> backgroundTasks,
    DriveStatusService drive) : IAdminDashboardDataProvider
{
    public async Task<AdminDashboardData> GetAsync(CancellationToken cancellationToken)
    {
        var customers = await users.GetUsersInRoleAsync("Customer");
        var orderQuery = session.Query<ContentItem, ContentItemIndex>(
            item => item.ContentType == "AbrITOrder" && item.Published);
        var totalOrders = await orderQuery.CountAsync();
        var recentOrders = await session.Query<ContentItem, ContentItemIndex>(
                item => item.ContentType == "AbrITOrder" && item.Published)
            .OrderByDescending(item => item.CreatedUtc)
            .Take(100)
            .ListAsync();
        var recentPayments = await payments.ListAsync("Default", 100, cancellationToken);
        var recentSms = await sms.ListAsync("Default", 100, cancellationToken);
        var pendingOrders = recentOrders.Count(IsPending);
        return new AdminDashboardData
        {
            Customers = customers.Count.ToString("N0"),
            Orders = totalOrders.ToString("N0"),
            PendingOrders = FormatSampleCount(pendingOrders, totalOrders),
            PaymentAttempts = recentPayments.Count.ToString("N0"),
            FailedPayments = recentPayments.Count(item => item.Status is PaymentAttemptStatus.Failed
                or PaymentAttemptStatus.Declined or PaymentAttemptStatus.Expired).ToString("N0"),
            SmsQueue = recentSms.Count(item => item.Status is SmsMessageStatus.Pending
                or SmsMessageStatus.Processing or SmsMessageStatus.RetryScheduled).ToString("N0"),
            FailedSms = recentSms.Count(item => item.Status is SmsMessageStatus.Failed
                or SmsMessageStatus.DeadLetter).ToString("N0"),
            BackgroundJobs = backgroundTasks.Count().ToString("N0"),
            DriveConfiguration = drive.IsConfigured ? "پیکربندی شده" : "پیکربندی نشده",
            RegistrationDatesAvailable = false,
            RecentOrders = recentOrders.Take(8)
                .Select(item => new DashboardOrder(
                    item.ContentItemId,
                    string.IsNullOrWhiteSpace(item.DisplayText) ? "سفارش بدون عنوان" : item.DisplayText,
                    GetOrderStatus(item),
                    item.CreatedUtc?.ToString() ?? "—"))
                .ToArray()
        };
    }

    private static string FormatSampleCount(int count, int total) =>
        total > 100 ? $"{count:N0} از ۱۰۰ اخیر" : count.ToString("N0");

    private static string GetOrderStatus(ContentItem item) =>
        item.Content["AbrITOrder"]?["Status"]?["Text"]?.ToString() ?? "در انتظار";

    private static bool IsPending(ContentItem item) =>
        GetOrderStatus(item) is not ("فعال" or "Active" or "تکمیل" or "Completed"
            or "لغو" or "لغو شده" or "Cancelled");
}
