namespace AbrITPortal.Notifications;

public enum SmsPurpose
{
    OtpRegistration = 0,
    OtpPasswordRecovery = 1,
    OtpMobileVerification = 2,
    OrderCreated = 10,
    PaymentConfirmed = 11,
    ProvisioningCompleted = 12,
    Administrative = 20
}

public enum SmsMessageStatus
{
    Pending = 0,
    Processing = 1,
    Submitted = 2,
    SentAccepted = 3,
    Delivered = 4,
    RetryScheduled = 5,
    Failed = 6,
    DeadLetter = 7,
    Cancelled = 8
}

public enum SmsFailureCategory
{
    None = 0,
    Configuration = 1,
    Validation = 2,
    RateLimit = 3,
    ProviderRejected = 4,
    NetworkTimeout = 5,
    AmbiguousSubmitted = 6,
    Expired = 7,
    Unknown = 99
}

public enum SmsPriority
{
    Low = 0,
    Normal = 1,
    High = 5,
    Otp = 10
}

public sealed record SmsSendRequest(
    string TenantId,
    string Recipient,
    SmsPurpose Purpose,
    string? TemplateKey,
    IReadOnlyDictionary<string, string>? Parameters,
    string? PlainTextMessage,
    SmsPriority Priority,
    string IdempotencyKey,
    DateTimeOffset? ExpiresUtc,
    bool ContainsSensitiveOtpPayload);

public sealed record SmsSendResult(
    bool Accepted,
    bool Ambiguous,
    string? ProviderMessageId,
    string? ProviderStatus,
    SmsFailureCategory FailureCategory,
    string? ErrorMessage,
    string? SanitizedResponse);

public interface ISmsProviderV2
{
    string Code { get; }
    bool IsEnabled { get; }
    Task<SmsSendResult> SendAsync(SmsSendRequest request, CancellationToken ct);
}

public sealed class SmsOutboxMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantId { get; set; } = string.Empty;
    public string ProviderCode { get; set; } = "smsir";
    public string Recipient { get; set; } = string.Empty;
    public SmsPurpose Purpose { get; set; }
    public string? TemplateKey { get; set; }
    public string? ParametersJson { get; set; } // no OTP plaintext
    public string? MessagePreview { get; set; } // sanitized/non-sensitive
    public string? ProtectedPayload { get; set; } // short-lived encrypted payload for OTP dispatch if required; purged after use
    public SmsPriority Priority { get; set; } = SmsPriority.Normal;
    public SmsMessageStatus Status { get; set; } = SmsMessageStatus.Pending;
    public string IdempotencyKey { get; set; } = string.Empty;
    public int AttemptCount { get; set; }
    public int MaxAttempts { get; set; } = 8;
    public DateTimeOffset CreatedUtc { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? NextAttemptUtc { get; set; }
    public DateTimeOffset? ProcessingLeaseUntilUtc { get; set; }
    public string? ProcessingWorker { get; set; }
    public DateTimeOffset? ExpiresUtc { get; set; }
    public DateTimeOffset? SubmittedUtc { get; set; }
    public DateTimeOffset? CompletedUtc { get; set; }
    public string? ProviderMessageId { get; set; }
    public string? ProviderStatus { get; set; }
    public SmsFailureCategory FailureCategory { get; set; }
    public string? LastError { get; set; }
    public string? SanitizedMetadata { get; set; }
}
