namespace AbrITPortal.Payments;

public sealed class PaymentAttemptRecord
{
    public Guid AttemptId { get; set; } = Guid.NewGuid();
    public string TenantId { get; set; } = string.Empty;
    public string OrderId { get; set; } = string.Empty;
    public string ProviderCode { get; set; } = string.Empty;
    public string? GatewayRequestId { get; set; }
    public string? GatewayAuthority { get; set; }
    public string? GatewayReference { get; set; }
    public decimal OriginalAmount { get; set; }
    public string OriginalCurrency { get; set; } = "IRT";
    public decimal ProviderAmount { get; set; }
    public string ProviderCurrency { get; set; } = "IRT";
    public PaymentAttemptStatus Status { get; set; } = PaymentAttemptStatus.Created;
    public PaymentTransactionState TransactionState { get; set; } = PaymentTransactionState.None;
    public DateTimeOffset CreatedUtc { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedUtc { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? VerifiedUtc { get; set; }
    public DateTimeOffset? SettledUtc { get; set; }
    public string? SanitizedResponseMetadata { get; set; }
    public PaymentErrorCategory ErrorCategory { get; set; }
    public string? LastError { get; set; }
    public int RetryCount { get; set; }
    public DateTimeOffset? NextReconciliationUtc { get; set; }
    public int Version { get; set; }
    public string? IdempotencyKey { get; set; }
}

public sealed class PaymentTransactionRecord
{
    public Guid TransactionId { get; set; } = Guid.NewGuid();
    public Guid AttemptId { get; set; }
    public string TenantId { get; set; } = string.Empty;
    public string OrderId { get; set; } = string.Empty;
    public PaymentTransactionState State { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "IRT";
    public string? ProviderReference { get; set; }
    public DateTimeOffset OccurredUtc { get; set; } = DateTimeOffset.UtcNow;
    public string? Details { get; set; }
}

public sealed class RefundAttemptRecord
{
    public Guid RefundId { get; set; } = Guid.NewGuid();
    public Guid AttemptId { get; set; }
    public string TenantId { get; set; } = string.Empty;
    public string OrderId { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "IRT";
    public bool Partial { get; set; }
    public RefundStatus Status { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string RequestedBy { get; set; } = string.Empty;
    public DateTimeOffset RequestedUtc { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedUtc { get; set; }
    public string? ProviderReference { get; set; }
    public string? AuditDetails { get; set; }
}
