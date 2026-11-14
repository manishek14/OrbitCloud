# ZARINPAL (v4 + Sandbox)

**Status:** REST adapter scaffold implemented, **live disabled**, sandbox/production separated in config, not externally verified.

## Intended operations (to verify against official v4 docs)
Payment request, redirect/StartPay, callback, server-side verify, duplicate verification handling, authority/reference persistence.

## Implementation
- `Payments/RestPaymentProviders.cs` (`ZarinPalPaymentProvider`) with typed `IHttpJsonTransport`, config gating, capability flags, authority extraction helper.
- Callback/verify security enforced by `PaymentVerificationService`.

## Configuration
- `PaymentProviderOptions:ZarinPal` disabled by default, `UseSandbox=true` when enabled for non-live, configurable URLs/merchant/callback.

## Blockers
- Full v4 fields/currency semantics and credentials not verified in-session. **Implemented but not externally verified.**
