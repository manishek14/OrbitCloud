using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.Hosting;
using AbrITPortal.Mobile;
using AbrITPortal.Notifications;

namespace AbrITPortal.Notifications;

/// <summary>
/// Bridges legacy Mobile.ISmsProvider (OTP/transactional) to v2 providers/outbox.
/// OTP codes are never logged or returned; sensitive payload protected and purged after dispatch attempt.
/// </summary>
public sealed class LegacySmsBridge(
    ISmsOutboxStore outboxStore,
    IEnumerable<ISmsProviderV2> providers,
    IOptions<NotificationOptions> options,
    IWebHostEnvironment environment) : ISmsProvider
{
    public Task SendVerifyLookupAsync(string mobile, string code, CancellationToken cancellationToken = default)
    {
        if (environment.IsProduction())
            throw new InvalidOperationException("Legacy Orchard SMS OTP is unavailable in Production; use the portal OTP flow.");
        return EnqueueOtpAsync(mobile, code, SmsPurpose.OtpRegistration, "otp:verify", cancellationToken);
    }

    public Task SendTransactionalAsync(string mobile, string message, CancellationToken cancellationToken = default)
    {
        var msg = new SmsOutboxMessage
        {
            TenantId = "Default",
            Recipient = mobile,
            Purpose = SmsPurpose.Administrative,
            MessagePreview = message.Length > 160 ? message[..160] : message,
            ParametersJson = System.Text.Json.JsonSerializer.Serialize(new Dictionary<string, string> { ["message"] = message }),
            Priority = SmsPriority.Normal,
            IdempotencyKey = "tx:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(mobile + "|" + message + "|" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + "|" + Guid.NewGuid().ToString("N")))),
            ExpiresUtc = DateTimeOffset.UtcNow.AddHours(24),
            NextAttemptUtc = DateTimeOffset.UtcNow,
            Status = SmsMessageStatus.Pending
        };
        return DirectOrQueueAsync(msg, cancellationToken);
    }

    private Task EnqueueOtpAsync(string mobile, string code, SmsPurpose purpose, string templateKey, CancellationToken ct)
    {
        var msg = new SmsOutboxMessage
        {
            TenantId = "Default",
            Recipient = mobile,
            Purpose = purpose,
            TemplateKey = templateKey,
            ParametersJson = null,
            MessagePreview = "[OTP]",
            ProtectedPayload = Convert.ToBase64String(Encoding.UTF8.GetBytes(code)), // short-lived transport-only; purged on submit/fail paths in store/processor
            Priority = SmsPriority.Otp,
            IdempotencyKey = "otp:" + purpose + ":" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(mobile + ":" + purpose + ":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + ":" + Guid.NewGuid().ToString("N")))),
            ExpiresUtc = DateTimeOffset.UtcNow.AddMinutes(2),
            NextAttemptUtc = DateTimeOffset.UtcNow,
            Status = SmsMessageStatus.Pending,
            MaxAttempts = 3
        };
        return DirectOrQueueAsync(msg, ct);
    }

    private async Task DirectOrQueueAsync(SmsOutboxMessage msg, CancellationToken ct)
    {
        var provider = providers.FirstOrDefault(p => p.IsEnabled && environment.IsDevelopment() && p.Code == "mock")
            ?? providers.FirstOrDefault(p => p.IsEnabled && p.Code != "mock");
        var request = new SmsSendRequest(msg.TenantId, msg.Recipient, msg.Purpose, msg.TemplateKey, null, msg.MessagePreview, msg.Priority, msg.IdempotencyKey, msg.ExpiresUtc, msg.ProtectedPayload != null);
        if (provider != null)
        {
            var result = await provider.SendAsync(request, ct);
            if (result.Accepted)
            {
                msg.Status = SmsMessageStatus.SentAccepted;
                msg.ProviderMessageId = result.ProviderMessageId;
                msg.ProviderStatus = result.ProviderStatus;
                msg.SanitizedMetadata = result.SanitizedResponse;
                msg.SubmittedUtc = DateTimeOffset.UtcNow;
                msg.ProtectedPayload = null;
                await outboxStore.EnqueueAsync(msg, ct);
                return;
            }
            if (result.Ambiguous)
            {
                msg.Status = SmsMessageStatus.Submitted;
                msg.FailureCategory = result.FailureCategory;
                msg.LastError = result.ErrorMessage;
                msg.SanitizedMetadata = result.SanitizedResponse;
                msg.SubmittedUtc = DateTimeOffset.UtcNow;
                msg.ProtectedPayload = null;
                await outboxStore.EnqueueAsync(msg, ct);
                return;
            }
        }
        msg.Status = SmsMessageStatus.Pending;
        await outboxStore.EnqueueAsync(msg, ct);
    }
}
