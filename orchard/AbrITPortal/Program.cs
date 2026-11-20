using AbrITPortal.Development;
using AbrITPortal.Drive;
using AbrITPortal.Orders;
using AbrITPortal.Mobile;
using AbrITPortal.Notifications;
using AbrITPortal.BackgroundJobs;
using AbrITPortal.Security;
using AbrITPortal.Commercial;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using SixLabors.ImageSharp.Web.Caching;
using OrchardCore.Environment.Shell;
using OrchardCore.Logging;
using OrchardCore.Queries;

var builder = WebApplication.CreateBuilder(args);
// The web root must exist in the published image before the host is built.
builder.WebHost.UseWebRoot("wwwroot");
DevelopmentEnvironment.Configure(builder);
builder.Host.UseNLogHost();

if (builder.Environment.IsProduction())
{
    var keyDirectory = builder.Configuration["AbrIT:DataProtection:KeysPath"]
        ?? "/var/lib/abrit-portal/data-protection-keys";
    if (!Path.IsPathFullyQualified(keyDirectory))
        throw new InvalidOperationException("Data Protection keys path must be absolute in Production.");
    builder.Services.AddDataProtection()
        .SetApplicationName("AbrITPortal")
        .PersistKeysToFileSystem(new DirectoryInfo(keyDirectory));
}

ISmsOutboxStore smsOutboxStore = new InMemorySmsOutboxStore(); // possibly replaced below

builder.Services.AddOrchardCms().ConfigureServices(services =>
{
    if (builder.Environment.IsProduction())
    {
        var cacheRoot = builder.Configuration["AbrIT:ImageSharp:CacheRootPath"]
            ?? "/var/lib/abrit-portal/imagesharp-cache";
        if (!Path.IsPathFullyQualified(cacheRoot))
            throw new InvalidOperationException("ImageSharp cache root must be absolute in Production.");
        services.PostConfigure<PhysicalFileSystemCacheOptions>(options => options.CacheRootPath = cacheRoot);
    }
    services.AddScoped<IAuthorizationHandler, OrderAuthorizationHandler>();
    services.AddQuerySource<OwnedOrdersQuerySource>(OwnedOrdersQuerySource.SourceName);
    services.AddMemoryCache();
    services.AddScoped<MobileIdentityService>();
    services.Configure<AbrITDriveOptions>(builder.Configuration.GetSection("AbrITDrive"));
    services.AddHttpClient<DriveStatusService>((sp, client) =>
    {
        var options = sp.GetRequiredService<IOptions<AbrITDriveOptions>>().Value;
        client.Timeout = TimeSpan.FromSeconds(Math.Clamp(options.TimeoutSeconds, 1, 30));
    })
    // .NET never transparently retries a non-idempotent request (MKCOL) on a
    // pooled connection that the remote closed; capping the lifetime bounds the
    // window in which a restarted Drive server would fail provisioning once.
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromMinutes(2),
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30)
    });

    // ------------------------------------------------------------------
    // ARCHITECTURE CORRECTION: payments are owned EXCLUSIVELY by the
    // Next.js commerce application (ZarinPal Sandbox + Zibal Sandbox with
    // server-side verification, PostgreSQL transactions). The previous
    // Orchard-side payment machinery (in-memory stores, providers,
    // orchestrator, reconciliation) was a SECOND source of truth and has
    // been removed from the DI container. The class files remain under
    // Payments/ as documented reference implementations only.
    // ------------------------------------------------------------------

    // The documented server-to-service contract to the canonical commerce
    // records (customers, orders, payments, subscriptions, Drive accounts,
    // tickets, pricing catalog). See Commercial/CommerceApiClient.cs.
    services.Configure<CommerceApiOptions>(builder.Configuration.GetSection("AbrIT:CommerceApi"));
    services.AddHttpClient<CommerceApiClient>();

    // SMS outbox for the Orchard-local identity flows: durable PostgreSQL
    // storage when a connection string is configured (AbrIT:SmsDatabase),
    // in-memory only in isolated development. The compose stack wires
    // AbrIT__SmsDatabase to the Orchard database in production, so the
    // outbox survives restarts; a Production deployment without it gets a
    // LOUD startup warning (full-remediation audit §4.5 — never silently
    // non-durable in production).
    var smsDatabase = builder.Configuration["AbrIT:SmsDatabase"];
    if (!string.IsNullOrWhiteSpace(smsDatabase))
        smsOutboxStore = new PostgresSmsOutboxStore(smsDatabase);
    services.AddSingleton<ISmsOutboxStore>(smsOutboxStore);
    services.AddSingleton<ISmsProviderV2, MockSmsProviderV2>();
    services.AddSingleton<ISmsProviderV2, SmsIrProvider>();
    services.AddScoped<ISmsOutboxService, SmsOutboxService>();
    services.AddScoped<ISmsNotificationService, SmsNotificationService>();
    services.AddScoped<SmsOutboxProcessor>();
    services.AddScoped<OrchardCore.Navigation.INavigationProvider, AbrITPortal.Infrastructure.InfrastructureAdminMenu>();
    services.AddSingleton<OrchardCore.BackgroundTasks.IBackgroundTask, AbrITPortal.BackgroundJobs.SmsOutboxBackgroundTask>();
    services.AddSingleton<OrchardCore.BackgroundTasks.IBackgroundTask, AbrITPortal.BackgroundJobs.SmsLeaseRecoveryBackgroundTask>();
    services.AddSingleton<OrchardCore.BackgroundTasks.IBackgroundTask, AbrITPortal.BackgroundJobs.OtpCleanupBackgroundTask>();
    // Legacy bridge for the Orchard-local identity flows (dev-facing); the
    // PRODUCTION customer OTP delivery is the SMS.ir flow in the commerce app.
    services.AddScoped<ISmsProvider, LegacySmsBridge>();

    // Behind the deployment reverse proxy the app sees plain HTTP while the
    // browser is on HTTPS, and the proxy rewrites X-Forwarded-Proto. Emit
    // RELATIVE challenge redirects so the browser resolves them against the
    // public scheme; ReturnUrl stays a local path, validated by the login page.
    services.ConfigureAll<CookieAuthenticationOptions>(options =>
    {
        options.Events.OnRedirectToLogin = context =>
        {
            var current = context.Request.Path + context.Request.QueryString;
            context.Response.Redirect(context.Options.LoginPath + "?ReturnUrl=" + Uri.EscapeDataString(current));
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.Redirect(context.Options.AccessDeniedPath);
            return Task.CompletedTask;
        };
    });
});

if (args.Contains("--abrit-maintenance") || args.Contains("--abrit-identity-setup") || args.Contains("--abrit-admin-bootstrap"))
    builder.WebHost.UseUrls("http://127.0.0.1:0");

var app = builder.Build();

// Full-remediation audit §4.5: a Production deployment running the SMS
// outbox in-memory is a deployment mistake (queued messages are lost on
// restart). Say so loudly instead of failing silently later.
if (app.Environment.IsProduction() && smsOutboxStore is InMemorySmsOutboxStore)
{
    app.Logger.LogWarning(
        "AbrIT:SmsDatabase is NOT configured — the SMS outbox is IN-MEMORY and NOT durable. " +
        "Queued messages are lost on restart. Configure AbrIT:SmsDatabase (docker-compose: AbrIT__SmsDatabase) " +
        "to enable the PostgreSQL-backed outbox.");
}

// Behind the deployment reverse proxy the public scheme is HTTPS while the app
// receives plain HTTP. Honor X-Forwarded-Proto (loopback proxy only) so
// authentication redirects and generated URLs keep the public scheme.
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedProto
});

if (!app.Environment.IsDevelopment())
{
    // TLS terminates at the reverse proxy; the app serves plain HTTP on
    // loopback, so there is no HTTPS redirection here. The previously
    // referenced "/Error" route never existed; unhandled exceptions are
    // handled by ASP.NET Core's default handler + structured NLog logging
    // (no redirect to a missing page).
    app.UseHsts();
}

// Behind the deployment reverse proxy the app sees plain HTTP while the
// browser is on HTTPS, and the proxy rewrites X-Forwarded-Proto. Orchard's
// tenant-level cookie handlers emit absolute http:// challenge redirects,
// which would bounce the browser off the public HTTPS origin. Rewrite every
// absolute Location the app produces back to its local path+query; the app
// never redirects off-site, so this is safe.
app.Use((context, next) =>
{
    context.Response.OnStarting(() =>
    {
        var location = context.Response.Headers.Location;
        if (location.Count > 0 &&
            Uri.TryCreate(location[0], UriKind.Absolute, out var uri) &&
            uri.Scheme is "http" or "https")
        {
            context.Response.Headers.Location = uri.PathAndQuery;
        }
        // Development preview embeds the portal in the platform's cross-origin
        // iframe; Orchard's SAMEORIGIN header would blank the panel. Production
        // keeps the header.
        if (app.Environment.IsDevelopment())
            context.Response.Headers.Remove("X-Frame-Options");
        return Task.CompletedTask;
    });
    return next();
});

app.UseStaticFiles();
app.UseOrchardCore();

if (args.Contains("--abrit-identity-setup"))
{
    if (!app.Environment.IsDevelopment())
        throw new InvalidOperationException("Identity setup is available only in Development.");
    await app.StartAsync();
    try
    {
        var host = app.Services.GetRequiredService<IShellHost>();
        await host.InitializeAsync();
        var first = await host.GetScopeAsync("Default");
        await first.UsingAsync(async shell =>
            await DevelopmentIdentitySetup.EnableFeaturesAsync(shell.ServiceProvider));
        var registrationScope = await host.GetScopeAsync("Default");
        await registrationScope.UsingAsync(async shell =>
            await DevelopmentIdentitySetup.DisableNativeRegistrationAsync(shell.ServiceProvider));
        var second = await host.GetScopeAsync("Default");
        await second.UsingAsync(async shell =>
            await DevelopmentIdentitySetup.ApplySettingsAsync(shell.ServiceProvider));
        Console.WriteLine("Development identity setup completed.");
    }
    finally
    {
        await app.StopAsync();
    }
    return;
}
if (args.Contains("--abrit-admin-bootstrap"))
{
    // Development by default; the sandbox CMS database requires the explicit
    // ABRIT_ADMIN_BOOTSTRAP_ENABLED=true opt-in (checked again inside the
    // database guard — defence in depth).
    var bootstrapOptIn = string.Equals(
        Environment.GetEnvironmentVariable("ABRIT_ADMIN_BOOTSTRAP_ENABLED"), "true", StringComparison.OrdinalIgnoreCase);
    if (!app.Environment.IsDevelopment() && !bootstrapOptIn)
        throw new InvalidOperationException(
            "Admin bootstrap requires Development, or the explicit ABRIT_ADMIN_BOOTSTRAP_ENABLED=true opt-in.");
    await app.StartAsync();
    try
    {
        var host = app.Services.GetRequiredService<IShellHost>();
        await host.InitializeAsync();
        var scope = await host.GetScopeAsync("Default");
        await scope.UsingAsync(async shell =>
            await DevelopmentIdentitySetup.BootstrapAdminAsync(shell.ServiceProvider));
        Console.WriteLine("Development admin bootstrap completed.");
    }
    finally
    {
        await app.StopAsync();
    }
    return;
}
if (args.Contains("--abrit-maintenance"))
{
    if (!app.Environment.IsDevelopment())
        throw new InvalidOperationException("Maintenance is available only in Development.");
    await app.StartAsync();
    try
    {
        var host = app.Services.GetRequiredService<IShellHost>();
        await host.InitializeAsync();
        var scope = await host.GetScopeAsync("Default");
        await scope.UsingAsync(async shell => {
            await DevelopmentMaintenance.ApplyAsync(shell.ServiceProvider);
        });
        var verificationScope = await host.GetScopeAsync("Default");
        await verificationScope.UsingAsync(async shell => {
            await DevelopmentMaintenance.ProcessIndexAsync(shell.ServiceProvider);
            await DevelopmentMaintenance.VerifyAsync(shell.ServiceProvider);
        });
        Console.WriteLine("Development tenant maintenance completed.");
    }
    finally
    {
        await app.StopAsync();
    }
    return;
}

app.Run();
