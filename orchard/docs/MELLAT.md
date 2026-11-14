# MELLAT (Behpardakht Mellat)

**Status:** Adapter scaffold implemented, **live disabled**, not externally verified. No credentials/default terminal/password.

## Intended operations (to verify against official WSDL/contract)
`bpPayRequest`, `bpVerifyRequest`, `bpSettleRequest`, `bpInquiryRequest`, `bpReversalRequest` via SOAP/WSDL.

## Implementation
- `Payments/MellatPaymentProvider.cs` with capability flags (initiate/verify/settle/inquiry/reversal), config gating, typed results.
- `ISoapTransport`/`HttpSoapTransport` abstraction for controlled transport.
- Parsing helper for composite PayRequest response (`resCode,token`) for mocked transport tests.
- Distinct verify/settle states modeled in domain/state machine.

## Configuration
- `PaymentProviderOptions:Mellat` disabled by default; `TerminalId/UserName/UserPassword/WsdlUrl/CallbackPath` empty. HTTPS callback configurable. No fake live defaults.

## Tests
- Mocked response parsing/state handling locally. Live WSDL calls not executed.

## Blockers
- Official WSDL/contract and merchant credentials unavailable. **Implemented but not externally verified.**
