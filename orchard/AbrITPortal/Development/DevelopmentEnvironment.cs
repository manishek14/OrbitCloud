using System.Text.Json;
using Npgsql;
using OrchardCore.Environment.Shell;

namespace AbrITPortal.Development;

public static class DevelopmentEnvironment
{
    public static void Configure(WebApplicationBuilder builder)
    {
        if (!builder.Environment.IsDevelopment())
            return;

        var expected = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath,
            "../artifacts/development/App_Data"));
        var configured = Environment.GetEnvironmentVariable("ORCHARD_APP_DATA");
        if (string.IsNullOrWhiteSpace(configured)
            || !string.Equals(Path.GetFullPath(configured, builder.Environment.ContentRootPath),
                expected, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Development requires the isolated ORCHARD_APP_DATA directory. See docs/BASELINE.md.");

        var tenantFile = Path.Combine(expected, "Sites/Default/appsettings.json");
        using var document = JsonDocument.Parse(File.ReadAllText(tenantFile));
        var connectionString = document.RootElement.GetProperty("ConnectionString").GetString();
        var connection = new NpgsqlConnectionStringBuilder(connectionString);
        if (connection.Database?.StartsWith("abrit_portal_dev_", StringComparison.Ordinal) != true)
            throw new InvalidOperationException("Development refused a database outside the abrit_portal_dev_ namespace.");

        using var tenants = JsonDocument.Parse(File.ReadAllText(Path.Combine(expected, "tenants.json")));
        if (tenants.RootElement.EnumerateObject().Any(x => x.Name != "Default"))
            throw new InvalidOperationException("Only the verified Default development tenant is supported.");

        // Pin both the shell file and host configuration; never fall back to original App_Data.
        builder.Configuration["OrchardCore:Default:ConnectionString"] = connectionString;
        builder.Configuration["OrchardCore:Default:DatabaseProvider"] = "Postgres";
        builder.Configuration["Logging:LogLevel:YesSql"] = "Warning";
        builder.Services.Configure<ShellOptions>(options => options.ShellsApplicationDataPath = expected);
    }
}
