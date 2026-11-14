# ZIBAL

**Status:** REST adapter scaffold implemented, **live disabled**, not externally verified.

## Intended operations (to verify against official docs)
Request, redirect, callback, verify, track/reference persistence, duplicate verification handling.

## Implementation
- `Payments/RestPaymentProviders.cs` (`ZibalPaymentProvider`) with `IHttpJsonTransport`, config gating, no hardcoded test merchant in production config.

## Configuration
- `PaymentProviderOptions:Zibal` disabled by default, configurable merchant/URLs/callback/start-pay base.

## Blockers
- Official API details and credentials unavailable. **Implemented but not externally verified.**
