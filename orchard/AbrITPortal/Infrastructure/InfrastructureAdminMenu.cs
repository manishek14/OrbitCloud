using Microsoft.Extensions.Localization;
using OrchardCore.Navigation;
using AbrITPortal.Commercial;

namespace AbrITPortal.Infrastructure;

/// <summary>
/// The "AbrIT" business administration menu group inside the REAL Orchard
/// administration. Business records are read from the canonical commerce
/// application through the documented server-to-server API.
/// </summary>
public sealed class InfrastructureAdminMenu(IStringLocalizer<InfrastructureAdminMenu> S) : INavigationProvider
{
    public ValueTask BuildNavigationAsync(string name, NavigationBuilder builder)
    {
        if (!string.Equals(name, "admin", StringComparison.OrdinalIgnoreCase))
            return ValueTask.CompletedTask;

        builder.Add(S["AbrIT"], "55", ops => ops
            .AddClass("abrit-operations").Id("abrit-operations")
            .Add(S["داشبورد"], "1", item => item.Url("/Admin").Permission(CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-gauge-high"))
            .Add(S["مشتریان"], "2", item => item.Url("/Admin/AbrIT/Customers").Permission(CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-users"))
            .Add(S["سفارش‌ها"], "3", item => item.Url("/Admin/AbrIT/Orders").Permission(CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-bag-shopping"))
            .Add(S["تعرفه پکیج‌ها"], "4", item => item.Url("/Admin/AbrIT/Plans").Permission(CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-layer-group"))
            .Add(S["پرداخت‌ها"], "5", item => item.Url("/Admin/AbrIT/Payments").Permission(CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-credit-card"))
            .Add(S["اشتراک‌ها"], "6", item => item.Url("/Admin/AbrIT/Subscriptions").Permission(CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-calendar-check"))
            .Add(S["AbrIT Drive"], "7", item => item.Url("/Admin/AbrIT/Drive").Permission(CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-cloud"))
            .Add(S["تیکت‌ها"], "8", item => item.Url("/Admin/AbrIT/Tickets").Permission(CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-headset"))
            .Add(S["گزارش‌ها"], "9", item => item.Url("/Admin/AbrIT/Reports").Permission(CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-chart-column"))
            .Add(S["تنظیمات سامانه"], "10", item => item.Url("/Admin/AbrIT/Settings").Permission(CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-sliders")));
        return ValueTask.CompletedTask;
    }
}
