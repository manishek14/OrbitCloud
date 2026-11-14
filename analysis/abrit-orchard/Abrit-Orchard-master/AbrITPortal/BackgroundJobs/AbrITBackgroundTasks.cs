using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using OrchardCore.BackgroundTasks;

namespace AbrITPortal.BackgroundJobs;

public abstract class AbrITBackgroundTask : IBackgroundTask
{
    private static readonly ConcurrentDictionary<string, DateTimeOffset> LastRun = new();
    protected static bool TryAcquireOverlapGuard(string key, TimeSpan minInterval)
    {
        var now = DateTimeOffset.UtcNow;
        var prev = LastRun.GetOrAdd(key, DateTimeOffset.MinValue);
        if (now - prev < minInterval) return false;
        LastRun[key] = now;
        return true;
    }

    public abstract Task DoWorkAsync(IServiceProvider serviceProvider, CancellationToken cancellationToken);
}

[BackgroundTask(Schedule = "*/1 * * * *", Description = "Process pending SMS outbox messages (durable queue, DB-claimed batches).")]
public sealed class SmsOutboxBackgroundTask : AbrITBackgroundTask
{
    public override async Task DoWorkAsync(IServiceProvider serviceProvider, CancellationToken cancellationToken)
    {
        if (!TryAcquireOverlapGuard("sms-outbox", TimeSpan.FromSeconds(20))) return;
        try
        {
            using var scope = serviceProvider.CreateScope();
            var processor = scope.ServiceProvider.GetService<SmsOutboxProcessor>();
            if (processor == null) return;
            await processor.ProcessBatchAsync("Default", Environment.MachineName + ":" + Environment.ProcessId, cancellationToken);
        }
        catch (Exception ex)
        {
            serviceProvider.GetService<ILogger<SmsOutboxBackgroundTask>>()?.LogWarning(ex, "SMS outbox task failed");
        }
    }
}

[BackgroundTask(Schedule = "*/5 * * * *", Description = "Recover stalled SMS worker leases and schedule retries.")]
public sealed class SmsLeaseRecoveryBackgroundTask : AbrITBackgroundTask
{
    public override async Task DoWorkAsync(IServiceProvider serviceProvider, CancellationToken cancellationToken)
    {
        if (!TryAcquireOverlapGuard("sms-lease", TimeSpan.FromMinutes(2))) return;
        try
        {
            using var scope = serviceProvider.CreateScope();
            var store = scope.ServiceProvider.GetService<AbrITPortal.Notifications.ISmsOutboxStore>();
            if (store == null) return;
            await store.RecoverExpiredLeasesAsync(DateTimeOffset.UtcNow, cancellationToken);
        }
        catch (Exception ex)
        {
            serviceProvider.GetService<ILogger<SmsLeaseRecoveryBackgroundTask>>()?.LogWarning(ex, "SMS lease recovery task failed");
        }
    }
}

[BackgroundTask(Schedule = "*/10 * * * *", Description = "Reconcile pending/ambiguous payment attempts (mock-safe).")]
public sealed class PaymentReconciliationBackgroundTask : AbrITBackgroundTask
{
    public override async Task DoWorkAsync(IServiceProvider serviceProvider, CancellationToken cancellationToken)
    {
        if (!TryAcquireOverlapGuard("pay-recon", TimeSpan.FromMinutes(5))) return;
        try
        {
            using var scope = serviceProvider.CreateScope();
            var svc = scope.ServiceProvider.GetService<AbrITPortal.Payments.PaymentReconciliationService>();
            if (svc == null) return;
            await svc.ReconcilePendingAsync("Default", 20, cancellationToken);
        }
        catch (Exception ex)
        {
            serviceProvider.GetService<ILogger<PaymentReconciliationBackgroundTask>>()?.LogWarning(ex, "Payment reconciliation task failed");
        }
    }
}

[BackgroundTask(Schedule = "0 * * * *", Description = "Cleanup expired OTP/challenge operational artifacts (best-effort).")]
public sealed class OtpCleanupBackgroundTask : AbrITBackgroundTask
{
    public override Task DoWorkAsync(IServiceProvider serviceProvider, CancellationToken cancellationToken)
    {
        if (!TryAcquireOverlapGuard("otp-clean", TimeSpan.FromMinutes(30))) return Task.CompletedTask;
        // OTP challenges currently managed in-memory by MobileIdentityService (IMemoryCache expirations);
        // durable challenge cleanup hooks can be added when persistent OTP store is enabled. No destructive DB action.
        return Task.CompletedTask;
    }
}
