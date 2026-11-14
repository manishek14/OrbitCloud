using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using AbrITPortal.Notifications;

namespace AbrITPortal.BackgroundJobs;

public sealed class SmsOutboxProcessor(
    ISmsOutboxStore store,
    IEnumerable<ISmsProviderV2> providers,
    IOptions<NotificationOptions> options,
    ILogger<SmsOutboxProcessor> logger)
{
    public async Task<int> ProcessBatchAsync(string tenantId, string workerId, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        await store.RecoverExpiredLeasesAsync(now, ct);
        var batch = await store.ClaimBatchAsync(tenantId, workerId, Math.Max(1, options.Value.Queue.BatchSize), TimeSpan.FromSeconds(Math.Max(30, options.Value.Queue.LeaseSeconds)), now, ct);
        var processed = 0;
        foreach (var msg in batch)
        {
            if (msg.ExpiresUtc.HasValue && msg.ExpiresUtc <= now)
            {
                await store.MarkFailedAsync(msg.Id, SmsFailureCategory.Expired, "Expired before dispatch", false, ct);
                continue;
            }
            var provider = providers.FirstOrDefault(p => p.IsEnabled && string.Equals(p.Code, msg.ProviderCode, StringComparison.OrdinalIgnoreCase));
            if (provider is null)
            {
                await ScheduleRetryAsync(msg, SmsFailureCategory.Configuration, "No SMS provider enabled", false, ct);
                continue;
            }
            try
            {
                var req = new SmsSendRequest(msg.TenantId, msg.Recipient, msg.Purpose, msg.TemplateKey, null, msg.MessagePreview, msg.Priority, msg.IdempotencyKey, msg.ExpiresUtc, msg.ProtectedPayload != null);
                var result = await provider.SendAsync(req, ct);
                if (result.Accepted)
                {
                    await store.MarkSubmittedAsync(msg.Id, result.ProviderMessageId, result.ProviderStatus, result.SanitizedResponse, ct);
                }
                else if (result.Ambiguous)
                {
                    // timeout after submission: do not blindly resend
                    await store.MarkRetryAsync(msg.Id, SmsFailureCategory.AmbiguousSubmitted, result.ErrorMessage, now.AddMinutes(10), ambiguousSubmitted: true, ct);
                }
                else
                {
                    await ScheduleRetryAsync(msg, result.FailureCategory == SmsFailureCategory.None ? SmsFailureCategory.ProviderRejected : result.FailureCategory, result.ErrorMessage, false, ct);
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "SMS dispatch error for {MessageId}", msg.Id);
                await ScheduleRetryAsync(msg, SmsFailureCategory.NetworkTimeout, "Dispatch exception", false, ct);
            }
            processed++;
        }
        return processed;
    }

    private async Task ScheduleRetryAsync(SmsOutboxMessage msg, SmsFailureCategory category, string? error, bool ambiguous, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        if (msg.AttemptCount >= msg.MaxAttempts)
        {
            await store.MarkFailedAsync(msg.Id, category, error, deadLetter: true, ct);
            return;
        }
        var baseSec = Math.Max(10, options.Value.Queue.BaseRetrySeconds);
        var maxSec = Math.Max(baseSec, options.Value.Queue.MaxRetrySeconds);
        var exp = Math.Min(maxSec, baseSec * Math.Pow(2, Math.Max(0, msg.AttemptCount - 1)));
        var jitter = Random.Shared.Next(0, Math.Max(1, (int)(exp * 0.2)));
        var next = now.AddSeconds(exp + jitter);
        if (msg.ExpiresUtc.HasValue && next >= msg.ExpiresUtc.Value)
        {
            await store.MarkFailedAsync(msg.Id, SmsFailureCategory.Expired, "Expired before next retry", false, ct);
            return;
        }
        await store.MarkRetryAsync(msg.Id, category, error, next, ambiguous, ct);
    }
}

// minimal shim to avoid hard dep in processor signature
public interface IDataProtectionProviderShim { string? Unprotect(string protectedPayload); }
public sealed class NoopProtectionShim : IDataProtectionProviderShim { public string? Unprotect(string protectedPayload) => null; }

