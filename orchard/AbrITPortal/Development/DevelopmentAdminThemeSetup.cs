using OrchardCore.Environment.Shell;
using OrchardCore.Settings;

namespace AbrITPortal.Development;

public static class DevelopmentAdminThemeSetup
{
    public static async Task ApplyAsync(IServiceProvider services)
    {
        var environment = services.GetRequiredService<IHostEnvironment>();
        if (!environment.IsDevelopment())
            throw new InvalidOperationException("Admin theme setup is development-only.");

        var features = services.GetRequiredService<IShellFeaturesManager>();
        var theme = (await features.GetAvailableFeaturesAsync())
            .SingleOrDefault(feature => feature.Id == "AbrITAdminTheme")
            ?? throw new InvalidOperationException("AbrITAdminTheme was not discovered by Orchard.");

        var sites = services.GetRequiredService<ISiteService>();
        var site = await sites.LoadSiteSettingsAsync();
        site.Properties["CurrentAdminThemeName"] = theme.Id;
        await sites.UpdateSiteSettingsAsync(site);
        if (!(await features.GetEnabledFeaturesAsync()).Any(feature => feature.Id == theme.Id))
            await features.EnableFeaturesAsync(new[] { theme }, force: true);
    }
}
