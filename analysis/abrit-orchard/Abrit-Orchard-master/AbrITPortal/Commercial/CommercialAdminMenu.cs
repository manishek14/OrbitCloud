using Microsoft.Extensions.Localization;
using OrchardCore.Navigation;

namespace AbrITPortal.Commercial;

public sealed class CommercialAdminMenu(IStringLocalizer<CommercialAdminMenu> S) : INavigationProvider
{
    public ValueTask BuildNavigationAsync(string name, NavigationBuilder builder)
    {
        if (!string.Equals(name, "admin", StringComparison.OrdinalIgnoreCase))
            return ValueTask.CompletedTask;

        builder.Add(S["AbrIT Business"], "50", abrit => abrit
            .AddClass("abrit-business").Id("abrit-business")
            .Add(S["Commercial Plans"], "1", plans => plans
                .Action("Index", "CommercialPlansAdmin", new { area = "" })
                .Permission(new OrchardCore.Security.Permissions.Permission(CommercialPermissions.ManageCommercialPlans))
                .LocalNav()));

        return ValueTask.CompletedTask;
    }
}
