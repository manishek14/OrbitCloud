using Npgsql;
using Microsoft.AspNetCore.Identity;
using OrchardCore.Security;
using OrchardCore.Email;
using OrchardCore.Entities;
using OrchardCore.Environment.Shell;
using OrchardCore.Settings;
using OrchardCore.Users.Models;

namespace AbrITPortal.Development;

public static class DevelopmentIdentitySetup
{
    public static async Task EnableFeaturesAsync(IServiceProvider services)
    {
        EnsureDevelopment(services);
        var features = services.GetRequiredService<IShellFeaturesManager>();
        var available = await features.GetAvailableFeaturesAsync();
        var required = new[]
        {
            "OrchardCore.Email.Smtp",
            "OrchardCore.Users.Registration",
            "OrchardCore.Users.ResetPassword",
            "OrchardCore.Users.ChangeEmail",
        };
        await features.EnableFeaturesAsync(available.Where(x => required.Contains(x.Id)), force: true);

    }
    public static async Task DisableNativeRegistrationAsync(IServiceProvider services)
    {
        EnsureDevelopment(services);
        var features = services.GetRequiredService<IShellFeaturesManager>();
        var available = await features.GetAvailableFeaturesAsync();
        await features.DisableFeaturesAsync(available.Where(x => x.Id == "OrchardCore.Users.Registration"));
    }
    public static async Task ApplySettingsAsync(IServiceProvider services)
    {
        EnsureDevelopment(services);
        var sites = services.GetRequiredService<ISiteService>();
        var site = await sites.LoadSiteSettingsAsync();
        var registration = site.GetOrCreate<RegistrationSettings>();
        registration.UsersMustValidateEmail = false;
        registration.UsersAreModerated = false;
        registration.UseSiteTheme = true;
        site.Put(registration);

        var reset = site.GetOrCreate<ResetPasswordSettings>();
        reset.AllowResetPassword = true;
        reset.UseSiteTheme = true;
        site.Put(reset);

        var login = site.GetOrCreate<LoginSettings>();
        login.DisableLocalLogin = false;
        login.UseSiteTheme = true;
        site.Put(login);

        var changeEmail = site.GetOrCreate<ChangeEmailSettings>();
        changeEmail.AllowChangeEmail = true;
        site.Put(changeEmail);

        // Local pickup is a development-only transport. It never connects to SMTP.
        var email = site.GetOrCreate<EmailSettings>();
        email.DefaultProviderName = "SMTP";
        site.Put(email);
        var smtp = site.GetOrCreate<SmtpSettings>();
        smtp.IsEnabled = true;
        smtp.DefaultSender = "no-reply@abrit.invalid";
        smtp.DeliveryMethod = SmtpDeliveryMethod.SpecifiedPickupDirectory;
        smtp.PickupDirectoryLocation = "/";
        smtp.RequireCredentials = false;
        site.Put(smtp);

        await sites.UpdateSiteSettingsAsync(site);
        var roles = services.GetRequiredService<RoleManager<IRole>>();
        if (await roles.FindByNameAsync("Customer") is null)
        {
            var result = await roles.CreateAsync(new Role { RoleName = "Customer" });
            if (!result.Succeeded) throw new InvalidOperationException("Customer role creation failed.");
        }
        await EnsureMobileUniquenessAsync(services);
    }

    private static async Task EnsureMobileUniquenessAsync(IServiceProvider services)
    {
        var settings = services.GetRequiredService<ShellSettings>();
        await using var connection = new NpgsqlConnection(settings["ConnectionString"]);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE UNIQUE INDEX IF NOT EXISTS "UX_AbrIT_VerifiedMobile"
            ON "Document" (("Content"::jsonb->>'PhoneNumber'))
            WHERE "Type" = 'OrchardCore.Users.Models.User, OrchardCore.Users.Core'
              AND "Content"::jsonb->>'PhoneNumberConfirmed' = 'true'
              AND nullif("Content"::jsonb->>'PhoneNumber', '') IS NOT NULL
            """;
        await command.ExecuteNonQueryAsync();
    }
    private static void EnsureDevelopment(IServiceProvider services)
    {
        var database = new NpgsqlConnectionStringBuilder(
            services.GetRequiredService<ShellSettings>()["ConnectionString"]).Database;
        if (database?.StartsWith("abrit_portal_dev_", StringComparison.Ordinal) != true)
            throw new InvalidOperationException("Identity setup refused a non-development database.");
    }
}
