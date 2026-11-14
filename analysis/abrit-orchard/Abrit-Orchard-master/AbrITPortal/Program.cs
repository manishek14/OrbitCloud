using AbrITPortal.Development;
using AbrITPortal.Drive;
using AbrITPortal.Orders;
using AbrITPortal.Mobile;
using AbrITPortal.Notifications;
using AbrITPortal.BackgroundJobs;
using AbrITPortal.Security;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.HttpOverrides;
using OrchardCore.Environment.Shell;
using OrchardCore.Logging;
using OrchardCore.Queries;

var builder = WebApplication.CreateBuilder(args);
DevelopmentEnvironment.Configure(builder);
builder.Host.UseNLogHost();

builder.Services.AddOrchardCms().ConfigureServices(services =>
{
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

    // Infrastructure: payment/notification/outbox foundations (mock-first, live providers disabled by config)
    services.AddSingleton<AbrITPortal.Payments.IPaymentStore, AbrITPortal.Payments.InMemoryPaymentStore>();
    services.AddSingleton<ISmsOutboxStore, InMemorySmsOutboxStore>();
    services.AddSingleton<ISmsProviderV2, MockSmsProviderV2>();
    services.AddSingleton<ISmsProviderV2, SmsIrProvider>();
    services.AddScoped<AbrITPortal.Payments.IPaymentAmountConverter, AbrITPortal.Payments.PaymentAmountConverter>();
    services.AddScoped<AbrITPortal.Payments.IPaymentProviderRegistry>(sp => new AbrITPortal.Payments.PaymentProviderRegistry(sp.GetServices<AbrITPortal.Payments.IPaymentProvider>()));
    services.AddScoped<AbrITPortal.Payments.IPaymentProvider, AbrITPortal.Payments.MockPaymentProvider>();
    services.AddScoped<AbrITPortal.Payments.IPaymentProvider, AbrITPortal.Payments.MellatPaymentProvider>();
    services.AddScoped<AbrITPortal.Payments.IPaymentProvider>(sp => new AbrITPortal.Payments.ZarinPalPaymentProvider(
        sp.GetRequiredService<IOptions<AbrITPortal.Payments.PaymentProviderOptions>>(),
        sp.GetService<AbrITPortal.Payments.IHttpJsonTransport>(),
        sp.GetRequiredService<ILogger<AbrITPortal.Payments.ZarinPalPaymentProvider>>(),
        sp.GetRequiredService<AbrITPortal.Payments.IPaymentAmountConverter>()));
    services.AddScoped<AbrITPortal.Payments.IPaymentProvider>(sp => new AbrITPortal.Payments.ZibalPaymentProvider(
        sp.GetRequiredService<IOptions<AbrITPortal.Payments.PaymentProviderOptions>>(),
        sp.GetService<AbrITPortal.Payments.IHttpJsonTransport>(),
        sp.GetRequiredService<ILogger<AbrITPortal.Payments.ZibalPaymentProvider>>(),
        sp.GetRequiredService<AbrITPortal.Payments.IPaymentAmountConverter>()));
    services.AddScoped<AbrITPortal.Payments.IPaymentOrchestrator, AbrITPortal.Payments.PaymentOrchestrator>();
    services.AddScoped<AbrITPortal.Payments.PaymentVerificationService>();
    services.AddScoped<AbrITPortal.Payments.PaymentReconciliationService>();
    services.AddScoped<ISmsOutboxService, SmsOutboxService>();
    services.AddScoped<ISmsNotificationService, SmsNotificationService>();
    services.AddScoped<AbrITPortal.Payments.IHttpJsonTransport, AbrITPortal.Payments.HttpJsonTransport>();
    services.AddScoped<AbrITPortal.Payments.ISoapTransport, AbrITPortal.Payments.HttpSoapTransport>();
    services.AddHttpClient("abrit-json").ConfigureHttpClient(c => c.Timeout = TimeSpan.FromSeconds(20));
    services.AddHttpClient("abrit-soap").ConfigureHttpClient(c => c.Timeout = TimeSpan.FromSeconds(30));
    services.AddScoped<SmsOutboxProcessor>();
    services.AddScoped<OrchardCore.Navigation.INavigationProvider, AbrITPortal.Infrastructure.InfrastructureAdminMenu>();
    services.AddSingleton<OrchardCore.BackgroundTasks.IBackgroundTask, AbrITPortal.BackgroundJobs.SmsOutboxBackgroundTask>();
    services.AddSingleton<OrchardCore.BackgroundTasks.IBackgroundTask, AbrITPortal.BackgroundJobs.SmsLeaseRecoveryBackgroundTask>();
    services.AddSingleton<OrchardCore.BackgroundTasks.IBackgroundTask, AbrITPortal.BackgroundJobs.PaymentReconciliationBackgroundTask>();
    services.AddSingleton<OrchardCore.BackgroundTasks.IBackgroundTask, AbrITPortal.BackgroundJobs.OtpCleanupBackgroundTask>();
    // Replace Kavenegar active provider with legacy bridge -> v2/mock-first (SMS.ir live blocked pending verified contract/credentials)
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

if (args.Contains("--abrit-maintenance") || args.Contains("--abrit-identity-setup"))
    builder.WebHost.UseUrls("http://127.0.0.1:0");

var app = builder.Build();

// Behind the deployment reverse proxy the public scheme is HTTPS while the app
// receives plain HTTP. Honor X-Forwarded-Proto (loopback proxy only) so
// authentication redirects and generated URLs keep the public scheme.
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedProto
});

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
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

app.UseHttpsRedirection();
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
