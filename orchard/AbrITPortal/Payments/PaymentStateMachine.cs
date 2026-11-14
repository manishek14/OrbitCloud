namespace AbrITPortal.Payments;

public static class PaymentStateMachine
{
    public static bool CanTransition(PaymentAttemptStatus from, PaymentAttemptStatus to) => (from, to) switch
    {
        _ when from == to => true,
        (PaymentAttemptStatus.Created, PaymentAttemptStatus.InitiationPending) => true,
        (PaymentAttemptStatus.Created, PaymentAttemptStatus.Initiated) => true,
        (PaymentAttemptStatus.Created, PaymentAttemptStatus.Failed) => true,
        (PaymentAttemptStatus.InitiationPending, PaymentAttemptStatus.Initiated) => true,
        (PaymentAttemptStatus.InitiationPending, PaymentAttemptStatus.Failed) => true,
        (PaymentAttemptStatus.InitiationPending, PaymentAttemptStatus.Ambiguous) => true,
        (PaymentAttemptStatus.Initiated, PaymentAttemptStatus.CallbackReceived) => true,
        (PaymentAttemptStatus.Initiated, PaymentAttemptStatus.Expired) => true,
        (PaymentAttemptStatus.Initiated, PaymentAttemptStatus.Ambiguous) => true,
        (PaymentAttemptStatus.Initiated, PaymentAttemptStatus.ReconciliationRequired) => true,
        (PaymentAttemptStatus.CallbackReceived, PaymentAttemptStatus.VerificationPending) => true,
        (PaymentAttemptStatus.CallbackReceived, PaymentAttemptStatus.Verified) => true,
        (PaymentAttemptStatus.CallbackReceived, PaymentAttemptStatus.Declined) => true,
        (PaymentAttemptStatus.CallbackReceived, PaymentAttemptStatus.Failed) => true,
        (PaymentAttemptStatus.CallbackReceived, PaymentAttemptStatus.Ambiguous) => true,
        (PaymentAttemptStatus.CallbackReceived, PaymentAttemptStatus.ReconciliationRequired) => true,
        (PaymentAttemptStatus.VerificationPending, PaymentAttemptStatus.Verified) => true,
        (PaymentAttemptStatus.VerificationPending, PaymentAttemptStatus.SettlementPending) => true,
        (PaymentAttemptStatus.VerificationPending, PaymentAttemptStatus.Declined) => true,
        (PaymentAttemptStatus.VerificationPending, PaymentAttemptStatus.Failed) => true,
        (PaymentAttemptStatus.VerificationPending, PaymentAttemptStatus.Ambiguous) => true,
        (PaymentAttemptStatus.VerificationPending, PaymentAttemptStatus.ReconciliationRequired) => true,
        (PaymentAttemptStatus.Verified, PaymentAttemptStatus.SettlementPending) => true,
        (PaymentAttemptStatus.Verified, PaymentAttemptStatus.Settled) => true,
        (PaymentAttemptStatus.Verified, PaymentAttemptStatus.Ambiguous) => true,
        (PaymentAttemptStatus.SettlementPending, PaymentAttemptStatus.Settled) => true,
        (PaymentAttemptStatus.SettlementPending, PaymentAttemptStatus.Ambiguous) => true,
        (PaymentAttemptStatus.SettlementPending, PaymentAttemptStatus.ReconciliationRequired) => true,
        (PaymentAttemptStatus.Ambiguous, PaymentAttemptStatus.Verified) => true,
        (PaymentAttemptStatus.Ambiguous, PaymentAttemptStatus.Settled) => true,
        (PaymentAttemptStatus.Ambiguous, PaymentAttemptStatus.Failed) => true,
        (PaymentAttemptStatus.Ambiguous, PaymentAttemptStatus.Declined) => true,
        (PaymentAttemptStatus.Ambiguous, PaymentAttemptStatus.ReconciliationRequired) => true,
        (PaymentAttemptStatus.ReconciliationRequired, PaymentAttemptStatus.Verified) => true,
        (PaymentAttemptStatus.ReconciliationRequired, PaymentAttemptStatus.Settled) => true,
        (PaymentAttemptStatus.ReconciliationRequired, PaymentAttemptStatus.Failed) => true,
        (PaymentAttemptStatus.ReconciliationRequired, PaymentAttemptStatus.Declined) => true,
        (PaymentAttemptStatus.ReconciliationRequired, PaymentAttemptStatus.Ambiguous) => true,
        _ => false
    };

    public static bool IsFinal(PaymentAttemptStatus status) => status is PaymentAttemptStatus.Settled or PaymentAttemptStatus.Failed or PaymentAttemptStatus.Declined or PaymentAttemptStatus.Cancelled or PaymentAttemptStatus.Expired;
    public static bool IsSuccess(PaymentAttemptStatus status) => status is PaymentAttemptStatus.Verified or PaymentAttemptStatus.Settled;
}
