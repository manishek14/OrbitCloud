using System.Collections.Concurrent;

namespace AbrITPortal.Mobile;

public interface ISmsProvider
{
    Task SendVerifyLookupAsync(string mobile, string code, CancellationToken cancellationToken = default);
    Task SendTransactionalAsync(string mobile, string message, CancellationToken cancellationToken = default);
}

public sealed class MockSmsProvider : ISmsProvider
{
    private readonly ConcurrentDictionary<string, string> _lastOtp = new();
    public Task SendVerifyLookupAsync(string mobile, string code, CancellationToken cancellationToken = default)
    {
        _lastOtp[mobile] = code;
        return Task.CompletedTask;
    }
    public Task SendTransactionalAsync(string mobile, string message, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
    public string? GetLastOtpForTest(string mobile) => _lastOtp.GetValueOrDefault(mobile);
}

// Fail closed until the durable SMS.ir path has a verified provider contract.
public sealed class UnavailableSmsProvider : ISmsProvider
{
    public Task SendVerifyLookupAsync(string mobile, string code, CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException("SMS.ir is not configured; OTP delivery is unavailable.");

    public Task SendTransactionalAsync(string mobile, string message, CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException("SMS.ir is not configured; message delivery is unavailable.");
}
