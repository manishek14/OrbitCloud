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
        using var scope = serviceProvider.CreateScope();
        var adminThemeService = scope.ServiceProvider.GetRequiredService<IAdminThemeService>();
        var currentTheme = adminThemeService.GetAdminThemeNameAsync().GetAwaiter().GetResult();

        if (string.IsNullOrWhiteSpace(currentTheme))
        {
            adminThemeService.SetAdminThemeAsync("AbrITAdminTheme").GetAwaiter().GetResult();
        }
    }
}
