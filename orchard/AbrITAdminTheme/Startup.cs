using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using OrchardCore.Admin;
using OrchardCore.Modules;

namespace AbrITAdminTheme;

public sealed class Startup : StartupBase
{
    public override void ConfigureServices(IServiceCollection services)
    {
        services.AddResourceConfiguration<ResourceManagementOptionsConfiguration>();
    }

    public override void Configure(IApplicationBuilder app, IEndpointRouteBuilder routes, IServiceProvider serviceProvider)
    {
        // Force-activate AbrITAdminTheme as THE admin theme on every shell
        // start — this is the dedicated AbrIT admin theme (based on TheAdmin,
        // carrying the `admin` theme tag) and must remain active even when a
        // previous setting pointed at TheAdmin or another theme.
        using var scope = serviceProvider.CreateScope();
        var adminThemeService = scope.ServiceProvider.GetRequiredService<IAdminThemeService>();
        var currentTheme = adminThemeService.GetAdminThemeNameAsync().GetAwaiter().GetResult();
        if (!string.Equals(currentTheme, "AbrITAdminTheme", StringComparison.OrdinalIgnoreCase))
        {
            adminThemeService.SetAdminThemeAsync("AbrITAdminTheme").GetAwaiter().GetResult();
        }
    }
}
