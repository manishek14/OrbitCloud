using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AbrITPortal.Notifications;

public interface ISmsOutboxStore
{
    Task<SmsOutboxMessage?> EnqueueAsync(SmsOutboxMessage message, CancellationToken ct); // null if duplicate idempotency
    Task<IReadOnlyList<SmsOutboxMessage>> ClaimBatchAsync(string tenantId, string workerId, int take, TimeSpan lease, DateTimeOffset now, CancellationToken ct);
    Task MarkSubmittedAsync(Guid id, string? providerMessageId, string? status, string? metadata, CancellationToken ct);
    Task MarkRetryAsync(Guid id, SmsFailureCategory category, string? error, DateTimeOffset nextAttemptUtc, bool ambiguousSubmitted, CancellationToken ct);
    Task MarkFailedAsync(Guid id, SmsFailureCategory category, string? error, bool deadLetter, CancellationToken ct);
    Task MarkCancelledAsync(Guid id, string reason, CancellationToken ct);
    Task<int> RecoverExpiredLeasesAsync(DateTimeOffset now, CancellationToken ct);
    Task<IReadOnlyList<SmsOutboxMessage>> ListAsync(string tenantId, int take, CancellationToken ct);
}

public sealed class InMemorySmsOutboxStore : ISmsOutboxStore
{
    private readonly object _gate = new();
    private readonly Dictionary<Guid, SmsOutboxMessage> _items = new();
    private readonly HashSet<string> _idempotency = new(StringComparer.Ordinal);

    public Task<SmsOutboxMessage?> EnqueueAsync(SmsOutboxMessage message, CancellationToken ct)
    {
        lock (_gate)
        {
            var key = message.TenantId + "|" + message.IdempotencyKey;
            if (!_idempotency.Add(key)) return Task.FromResult<SmsOutboxMessage?>(null);
            message.CreatedUtc = DateTimeOffset.UtcNow;
            message.NextAttemptUtc ??= message.CreatedUtc;
            _items[message.Id] = Clone(message);
            return Task.FromResult<SmsOutboxMessage?>(Clone(message));
        }
    }

    public Task<IReadOnlyList<SmsOutboxMessage>> ClaimBatchAsync(string tenantId, string workerId, int take, TimeSpan lease, DateTimeOffset now, CancellationToken ct)
    {
        lock (_gate)
        {
            var claimed = _items.Values
                .Where(x => x.TenantId == tenantId && (x.Status == SmsMessageStatus.Pending || x.Status == SmsMessageStatus.RetryScheduled)
                    && (x.NextAttemptUtc == null || x.NextAttemptUtc <= now)
                    && (x.ProcessingLeaseUntilUtc == null || x.ProcessingLeaseUntilUtc <= now)
                    && (x.ExpiresUtc == null || x.ExpiresUtc > now))
                .OrderByDescending(x => x.Priority).ThenBy(x => x.CreatedUtc)
                .Take(take).ToList();
            foreach (var m in claimed)
            {
                m.Status = SmsMessageStatus.Processing;
                m.ProcessingWorker = workerId;
                m.ProcessingLeaseUntilUtc = now.Add(lease);
                m.AttemptCount++;
            }
            return Task.FromResult<IReadOnlyList<SmsOutboxMessage>>(claimed.Select(Clone).ToList());
        }
    }

    public Task MarkSubmittedAsync(Guid id, string? providerMessageId, string? status, string? metadata, CancellationToken ct)
    { lock (_gate) if (_items.TryGetValue(id, out var m)) { m.Status = SmsMessageStatus.Submitted; m.ProviderMessageId = providerMessageId; m.ProviderStatus = status; m.SanitizedMetadata = metadata; m.SubmittedUtc = DateTimeOffset.UtcNow; m.ProcessingLeaseUntilUtc = null; m.ProtectedPayload = null; } return Task.CompletedTask; }
    public Task MarkRetryAsync(Guid id, SmsFailureCategory category, string? error, DateTimeOffset nextAttemptUtc, bool ambiguousSubmitted, CancellationToken ct)
    { lock (_gate) if (_items.TryGetValue(id, out var m)) { m.Status = ambiguousSubmitted ? SmsMessageStatus.Submitted : SmsMessageStatus.RetryScheduled; m.FailureCategory = category; m.LastError = error; m.NextAttemptUtc = nextAttemptUtc; m.ProcessingLeaseUntilUtc = null; if (!ambiguousSubmitted) m.ProtectedPayload = m.ProtectedPayload; } return Task.CompletedTask; }
    public Task MarkFailedAsync(Guid id, SmsFailureCategory category, string? error, bool deadLetter, CancellationToken ct)
    { lock (_gate) if (_items.TryGetValue(id, out var m)) { m.Status = deadLetter ? SmsMessageStatus.DeadLetter : SmsMessageStatus.Failed; m.FailureCategory = category; m.LastError = error; m.CompletedUtc = DateTimeOffset.UtcNow; m.ProcessingLeaseUntilUtc = null; m.ProtectedPayload = null; } return Task.CompletedTask; }
    public Task MarkCancelledAsync(Guid id, string reason, CancellationToken ct)
    { lock (_gate) if (_items.TryGetValue(id, out var m)) { m.Status = SmsMessageStatus.Cancelled; m.LastError = reason; m.CompletedUtc = DateTimeOffset.UtcNow; m.ProcessingLeaseUntilUtc = null; m.ProtectedPayload = null; } return Task.CompletedTask; }
    public Task<int> RecoverExpiredLeasesAsync(DateTimeOffset now, CancellationToken ct)
    { lock (_gate) { var n=0; foreach(var m in _items.Values.Where(x=>x.Status==SmsMessageStatus.Processing && x.ProcessingLeaseUntilUtc<=now)){ m.Status=SmsMessageStatus.RetryScheduled; m.NextAttemptUtc=now; m.ProcessingLeaseUntilUtc=null; n++; } return Task.FromResult(n); } }
    public Task<IReadOnlyList<SmsOutboxMessage>> ListAsync(string tenantId, int take, CancellationToken ct)
    { lock (_gate) return Task.FromResult<IReadOnlyList<SmsOutboxMessage>>(_items.Values.Where(x=>x.TenantId==tenantId).OrderByDescending(x=>x.CreatedUtc).Take(take).Select(Clone).ToList()); }

    private static SmsOutboxMessage Clone(SmsOutboxMessage m) => JsonSerializer.Deserialize<SmsOutboxMessage>(JsonSerializer.Serialize(m))!;
}

public interface ISmsOutboxService
{
    Task<Guid?> EnqueueAsync(SmsSendRequest request, CancellationToken ct);
}

public sealed class SmsOutboxService(ISmsOutboxStore store, IDataProtectionProvider dataProtection, IOptions<NotificationOptions> options) : ISmsOutboxService
{
    private readonly IDataProtector _protector = dataProtection.CreateProtector("AbrIT.SmsOutbox.Sensitive.v1");
    public async Task<Guid?> EnqueueAsync(SmsSendRequest request, CancellationToken ct)
    {
        var msg = new SmsOutboxMessage
        {
            TenantId = request.TenantId,
            Recipient = request.Recipient,
            Purpose = request.Purpose,
            TemplateKey = request.TemplateKey,
            ParametersJson = request.Parameters is null ? null : JsonSerializer.Serialize(request.Parameters.Where(kv => !IsSensitiveKey(kv.Key)).ToDictionary(k=>k.Key,v=>v.Value)),
            MessagePreview = request.PlainTextMessage is null ? null : (request.ContainsSensitiveOtpPayload ? "[protected]" : Truncate(request.PlainTextMessage, 160)),
            ProtectedPayload = request.ContainsSensitiveOtpPayload && request.Parameters != null ? _protector.Protect(JsonSerializer.Serialize(request.Parameters)) : null,
            Priority = request.Priority,
            IdempotencyKey = request.IdempotencyKey,
            ExpiresUtc = request.ExpiresUtc,
            NextAttemptUtc = DateTimeOffset.UtcNow,
            MaxAttempts = Math.Max(1, options.Value.Queue.MaxAttempts)
        };
        var stored = await store.EnqueueAsync(msg, ct);
        return stored?.Id;
    }
    private static bool IsSensitiveKey(string k) => k.Contains("otp", StringComparison.OrdinalIgnoreCase) || k.Contains("code", StringComparison.OrdinalIgnoreCase) || k.Contains("token", StringComparison.OrdinalIgnoreCase) || k.Contains("password", StringComparison.OrdinalIgnoreCase);
    private static string Truncate(string s, int n) => s.Length <= n ? s : s[..n];
}

public interface ISmsNotificationService
{
    Task QueueTransactionalAsync(string tenantId, string recipient, SmsPurpose purpose, string message, string idempotencyKey, CancellationToken ct);
}

public sealed class SmsNotificationService(ISmsOutboxService outbox) : ISmsNotificationService
{
    public Task QueueTransactionalAsync(string tenantId, string recipient, SmsPurpose purpose, string message, string idempotencyKey, CancellationToken ct)
        => outbox.EnqueueAsync(new SmsSendRequest(tenantId, recipient, purpose, null, null, message, SmsPriority.Normal, idempotencyKey, DateTimeOffset.UtcNow.AddHours(24), false), ct).ContinueWith(_ => { }, ct);
}


