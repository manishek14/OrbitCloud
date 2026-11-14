using Microsoft.Extensions.DependencyInjection;
using OrchardCore.Modules;
using OrchardCore.Security.Permissions;
using AbrITAdminTheme.Admin;

namespace AbrITPortal.Commercial;

public sealed class Startup : OrchardCore.Modules.StartupBase
{
    public override void ConfigureServices(IServiceCollection services)
    {
        services.AddSingleton<IPricingEngine, PricingEngine>();
        services.AddScoped<ICommercialRulesService, CommercialRulesService>();
        services.AddScoped<IPermissionProvider, CommercialPermissionProvider>();
        services.AddScoped<IAdminDashboardDataProvider, OperationsDashboardDataProvider>();
    }
}

public sealed class CommercialPermissionProvider : IPermissionProvider
{
    public static readonly Permission ManageCommercialPlans = new(CommercialPermissions.ManageCommercialPlans, "Manage AbrIT commercial plans");
    public static readonly Permission ManageAbrITOperations = new("ManageAbrITOperations", "Manage AbrIT operations");
    public Task<IEnumerable<Permission>> GetPermissionsAsync() => Task.FromResult<IEnumerable<Permission>>(new[] { ManageCommercialPlans, ManageAbrITOperations });
    public IEnumerable<PermissionStereotype> GetDefaultStereotypes() => new[]
    {
        new PermissionStereotype { Name = "Administrator", Permissions = new[] { ManageCommercialPlans, ManageAbrITOperations } }
    };
}
