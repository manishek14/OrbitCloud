using Microsoft.Extensions.DependencyInjection;
using OrchardCore.Modules;
using OrchardCore.Security.Permissions;
using AbrITAdminTheme.Admin;

namespace AbrITPortal.Commercial;

public sealed class Startup : OrchardCore.Modules.StartupBase
{
    public override void ConfigureServices(IServiceCollection services)
    {
        // ARCHITECTURE: the authoritative pricing engine lives in the commerce
        // application (single source of truth). The previous Orchard-side
        // IPricingEngine/ICommercialRulesService registrations (a second,
        // divergent pricing source with unapproved values) were removed; the
        // class files remain as documented reference implementations only.
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
