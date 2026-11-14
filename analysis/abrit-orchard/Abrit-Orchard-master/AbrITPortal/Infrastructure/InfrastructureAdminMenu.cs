using Microsoft.Extensions.Localization;
using OrchardCore.Navigation;
using OrchardCore.Security.Permissions;

namespace AbrITPortal.Infrastructure;

public sealed class InfrastructureAdminMenu(IStringLocalizer<InfrastructureAdminMenu> S) : INavigationProvider
{
    public ValueTask BuildNavigationAsync(string name, NavigationBuilder builder)
    {
        if (!string.Equals(name, "admin", StringComparison.OrdinalIgnoreCase))
            return ValueTask.CompletedTask;

        builder.Add(S["AbrIT"], "55", ops => ops
            .AddClass("abrit-operations").Id("abrit-operations")
            .Add(S["داشبورد"], "1", item => item.Url("/Admin").Permission(Commercial.CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-gauge-high"))
            .Add(S["مشتریان"], "2", item => item.Url("/Admin/AbrIT/Customers").Permission(Commercial.CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-users"))
            .Add(S["سفارش‌ها"], "3", item => item.Url("/Admin/AbrIT/Orders").Permission(Commercial.CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-bag-shopping"))
            .Add(S["پلن‌های خدمات"], "4", item => item.Url("/Admin/AbrIT/Commercial/Plans").Permission(Commercial.CommercialPermissionProvider.ManageCommercialPlans).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-layer-group"))
            .Add(S["پرداخت‌ها"], "5", item => item.Url("/Admin/AbrIT/Payments").Permission(Commercial.CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-credit-card"))
            .Add(S["صف و پیامک SMS.ir"], "6", item => item.Url("/Admin/AbrIT/Sms").Permission(Commercial.CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-comment-sms"))
            .Add(S["کارهای پس‌زمینه"], "7", item => item.Url("/Admin/AbrIT/Jobs").Permission(Commercial.CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-gears"))
            .Add(S["راه‌اندازی سرویس"], "8", item => item.Url("/Admin/AbrIT/Provisioning").Permission(Commercial.CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-server"))
            .Add(S["AbrIT Drive"], "9", item => item.Url("/Admin/AbrIT/Drive").Permission(Commercial.CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-cloud"))
            .Add(S["گزارش‌ها"], "10", item => item.Url("/Admin/AbrIT/Reports").Permission(Commercial.CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-chart-column"))
            .Add(S["تنظیمات سامانه"], "11", item => item.Url("/Admin/AbrIT/Settings").Permission(Commercial.CommercialPermissionProvider.ManageAbrITOperations).AddClass("icon-class-fa-solid").AddClass("icon-class-fa-sliders")));
        return ValueTask.CompletedTask;
    }
}
