using Npgsql;
using Microsoft.AspNetCore.Identity;
using OrchardCore.Security;
using OrchardCore.Email;
using OrchardCore.Entities;
using OrchardCore.Environment.Shell;
using OrchardCore.Settings;
using OrchardCore.Users;
using OrchardCore.Users.Models;
using OrchardCore.Localization.Models;

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

        // Persian RTL administration: TheAdmin derives <html dir> and its
        // Bootstrap LTR/RTL bundle from the site default culture, so fa-IR
        // MUST be the authoritative setting (the recipe's DefaultLanguage key
        // is not a supported settings step in OrchardCore 3.0.1).
        var localization = site.GetOrCreate<LocalizationSettings>();
        localization.DefaultCulture = "fa-IR";
        site.Put(localization);

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

    private static void EnsureBootstrapAllowed(IServiceProvider services)
    {
        var database = new NpgsqlConnectionStringBuilder(
            services.GetRequiredService<ShellSettings>()["ConnectionString"]).Database;
        var isDevDatabase = database?.StartsWith("abrit_portal_dev_", StringComparison.Ordinal) == true;
        var optedIn = string.Equals(
            Environment.GetEnvironmentVariable("ABRIT_ADMIN_BOOTSTRAP_ENABLED"), "true", StringComparison.OrdinalIgnoreCase);
        var isSandboxCms = string.Equals(database, "abrit_orchard", StringComparison.Ordinal);
        if (!isDevDatabase && !(optedIn && isSandboxCms))
            throw new InvalidOperationException(
                $"Admin bootstrap refused database '{database}'. Allowed: abrit_portal_dev_* tenants, " +
                "or the sandbox CMS database with an explicit ABRIT_ADMIN_BOOTSTRAP_ENABLED=true.");
    }

    /// <summary>
    /// Administrator bootstrap (operator-invoked CLI only — never an HTTP
    /// endpoint). Creates or resets the Orchard Identity administrator from
    /// environment variables, so documented credentials actually work and
    /// initial setup is reproducible:
    ///     ABRIT_ORCHARD_ADMIN_USERNAME (default abrit-admin)
    ///     ABRIT_ORCHARD_ADMIN_EMAIL    (default admin@abrit.ir)
    ///     ABRIT_ORCHARD_ADMIN_PASSWORD (required, min 12 chars)
    /// Database guards (defence in depth):
    ///   • Any abrit_portal_dev_* database — the isolated development tenant.
    ///   • The sandbox CMS database "abrit_orchard" ONLY when the operator
    ///     explicitly opted in with ABRIT_ADMIN_BOOTSTRAP_ENABLED=true.
    /// Production NEVER silently accepts this: any other database name is
    /// refused, and Orchard's normal secure setup flow applies there.
    /// </summary>
    public static async Task BootstrapAdminAsync(IServiceProvider services)
    {
        EnsureBootstrapAllowed(services);

        var username = (Environment.GetEnvironmentVariable("ABRIT_ORCHARD_ADMIN_USERNAME") ?? "abrit-admin").Trim();
        var email = (Environment.GetEnvironmentVariable("ABRIT_ORCHARD_ADMIN_EMAIL") ?? "admin@abrit.ir").Trim();
        var password = Environment.GetEnvironmentVariable("ABRIT_ORCHARD_ADMIN_PASSWORD");
        if (string.IsNullOrWhiteSpace(password) || password.Length < 12)
            throw new InvalidOperationException(
                "ABRIT_ORCHARD_ADMIN_PASSWORD must be set with at least 12 characters for the admin bootstrap.");

        var users = services.GetRequiredService<UserManager<IUser>>();
        var roles = services.GetRequiredService<RoleManager<IRole>>();
        if (await roles.FindByNameAsync("Administrator") is null)
        {
            var adminRole = await roles.CreateAsync(new Role { RoleName = "Administrator" });
            if (!adminRole.Succeeded)
                throw new InvalidOperationException("Administrator role creation failed.");
        }

        var user = await users.FindByNameAsync(username);
        if (user is null)
        {
            var created = await users.CreateAsync(new User { UserName = username, Email = email, EmailConfirmed = true }, password);
            if (!created.Succeeded)
                throw new InvalidOperationException(
                    "Admin user creation failed: " + string.Join("; ", created.Errors.Select(e => e.Description)));
            Console.WriteLine($"Admin bootstrap: created '{username}'.");
        }
        else
        {
            var token = await users.GeneratePasswordResetTokenAsync(user);
            var reset = await users.ResetPasswordAsync(user, token, password);
            if (!reset.Succeeded)
                throw new InvalidOperationException(
                    "Admin password reset failed: " + string.Join("; ", reset.Errors.Select(e => e.Description)));
            Console.WriteLine($"Admin bootstrap: password reset for existing '{username}'.");
        }

        var admin = await users.FindByNameAsync(username) ?? throw new InvalidOperationException("Admin user vanished after bootstrap.");
        if (!await users.IsInRoleAsync(admin, "Administrator"))
        {
            var added = await users.AddToRoleAsync(admin, "Administrator");
            if (!added.Succeeded)
                throw new InvalidOperationException("Administrator role assignment failed.");
        }
        Console.WriteLine("Admin bootstrap: Administrator role verified.");
    }
}
