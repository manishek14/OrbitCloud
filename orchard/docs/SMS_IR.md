# SMS.ir status (2026-11-10)

The existing Kavenegar adapter was removed from the active code path. Development uses an in-memory mock for the current mobile identity flow; other environments fail closed. The SMS.ir V2 provider is a disabled boundary: no official request mapping or credentials have been verified, and it cannot report itself enabled or send real messages. The former `LegacySmsBridge` was removed because it stored OTP with reversible Base64 and could submit before a durable outbox record existed.

The mobile identity flow still uses an in-memory OTP challenge and is not ready for multiple instances or restart recovery. SMS.ir integration requires the official merchant account API specification, template IDs and parameter names, authentication method, delivery/credit endpoints if offered, test credentials and an isolated test environment. Secrets belong in environment variables or secure storage. No real SMS was sent.
