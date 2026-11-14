using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OrchardCore.Modules;
using OrchardCore.Navigation;
using OrchardCore.Security.Permissions;
using AbrITPortal.Payments;
using AbrITPortal.Notifications;

namespace AbrITPortal.Infrastructure;

[Feature("AbrIT.Infrastructure")]
public sealed class Startup : OrchardCore.Modules.StartupBase
{
    public override void ConfigureServices(IServiceCollection services)
    {
        services.AddOptions<PaymentProviderOptions>();
        services.AddOptions<NotificationOptions>();

        // Shared payment, SMS, transport and outbox services are registered once in Program.cs.
    }
}
