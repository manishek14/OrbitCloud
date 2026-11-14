namespace AbrITPortal.Payments;

public enum PaymentProviderEnvironment
{
    Disabled = 0,
    Mock = 1,
    Sandbox = 2,
    Live = 3
}

public enum PaymentAttemptStatus
{
    Created = 0,
    InitiationPending = 1,
    Initiated = 2,
    CallbackReceived = 3,
    VerificationPending = 4,
    Verified = 5,
    SettlementPending = 6,
    Settled = 7,
    Failed = 8,
    Declined = 9,
    Cancelled = 10,
    Expired = 11,
    Ambiguous = 12,
    ReconciliationRequired = 13
}

public enum PaymentTransactionState
{
    None = 0,
    Authorized = 1,
    Verified = 2,
    Settled = 3,
    Reversed = 4,
    Refunded = 5,
    PartiallyRefunded = 6,
    Failed = 7
}

public enum PaymentErrorCategory
{
    None = 0,
    Configuration = 1,
    Validation = 2,
    ProviderRejected = 3,
    NetworkTimeout = 4,
    Ambiguous = 5,
    CallbackReplay = 6,
    AmountMismatch = 7,
    CurrencyMismatch = 8,
    ProviderError = 9,
    Concurrency = 10,
    UnsupportedOperation = 11,
    Unknown = 99
}

public enum RefundStatus
{
    Requested = 0,
    Processing = 1,
    Succeeded = 2,
    PartiallySucceeded = 3,
    Failed = 4,
    Unsupported = 5
}

[Flags]
public enum PaymentProviderCapabilities
{
    None = 0,
    Initiate = 1 << 0,
    Verify = 1 << 1,
    Settle = 1 << 2,
    Inquiry = 1 << 3,
    Refund = 1 << 4,
    PartialRefund = 1 << 5,
    Reversal = 1 << 6
}

public sealed record MoneyAmount(decimal Amount, string Currency);

public sealed record PaymentInitiationRequest(
    string TenantId,
    string OrderId,
    Guid AttemptId,
    MoneyAmount OriginalAmount,
    MoneyAmount ProviderAmount,
    string CallbackUrl,
    string Description,
    string? CustomerMobile,
    IReadOnlyDictionary<string, string>? Metadata);

public sealed record PaymentInitiationResult(
    bool Succeeded,
    PaymentAttemptStatus Status,
    string? RedirectUrl,
    string? GatewayRequestId,
    string? GatewayAuthority,
    string? ProviderMessage,
    PaymentErrorCategory ErrorCategory,
    string? SanitizedProviderData);

public sealed record PaymentVerificationRequest(
    string TenantId,
    string OrderId,
    Guid AttemptId,
    MoneyAmount OriginalAmount,
    MoneyAmount ProviderAmount,
    string? GatewayAuthority,
    string? GatewayReference,
    IReadOnlyDictionary<string, string>? CallbackParameters);

public sealed record PaymentVerificationResult(
    bool Succeeded,
    PaymentAttemptStatus Status,
    PaymentTransactionState TransactionState,
    bool RequiresSettlement,
    bool IsDuplicate,
    bool IsAmbiguous,
    string? GatewayReference,
    string? ProviderMessage,
    PaymentErrorCategory ErrorCategory,
    string? SanitizedProviderData);

public sealed record PaymentReconciliationRequest(
    string TenantId,
    string OrderId,
    Guid AttemptId,
    string? GatewayAuthority,
    string? GatewayReference);

public sealed record PaymentReconciliationResult(
    bool Succeeded,
    PaymentAttemptStatus Status,
    PaymentTransactionState TransactionState,
    bool IsAmbiguous,
    string? ProviderMessage,
    PaymentErrorCategory ErrorCategory,
    string? SanitizedProviderData);

public interface IPaymentProvider
{
    string Code { get; }
    PaymentProviderCapabilities Capabilities { get; }
    bool IsEnabled { get; }

    Task<PaymentInitiationResult> InitiateAsync(PaymentInitiationRequest request, CancellationToken cancellationToken);
    Task<PaymentVerificationResult> VerifyAsync(PaymentVerificationRequest request, CancellationToken cancellationToken);
    Task<PaymentReconciliationResult> ReconcileAsync(PaymentReconciliationRequest request, CancellationToken cancellationToken);
}

public sealed record RefundRequest(
    string TenantId,
    string OrderId,
    Guid AttemptId,
    Guid RefundId,
    MoneyAmount Amount,
    bool Partial,
    string Reason,
    string RequestedBy);

public sealed record RefundResult(
    bool Succeeded,
    RefundStatus Status,
    string? ProviderReference,
    string? ProviderMessage,
    PaymentErrorCategory ErrorCategory);
