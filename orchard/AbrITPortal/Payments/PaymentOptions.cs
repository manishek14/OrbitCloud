using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace AbrITPortal.Payments;

public sealed class PaymentProviderOptions
{
    public string DefaultProvider { get; set; } = "mock";
    public bool AllowPublicCheckout { get; set; } = false; // must remain false until M3
    public string CallbackBaseUrl { get; set; } = string.Empty;
    public MellatOptions Mellat { get; set; } = new();
    public ZarinPalOptions ZarinPal { get; set; } = new();
    public ZibalOptions Zibal { get; set; } = new();
    public MockPaymentOptions Mock { get; set; } = new() { Enabled = true, Environment = PaymentProviderEnvironment.Mock };
}

public sealed class MockPaymentOptions
{
    public bool Enabled { get; set; } = true;
    public PaymentProviderEnvironment Environment { get; set; } = PaymentProviderEnvironment.Mock;
}

public sealed class MellatOptions
{
    public bool Enabled { get; set; }
    public PaymentProviderEnvironment Environment { get; set; } = PaymentProviderEnvironment.Disabled;
    public string TerminalId { get; set; } = string.Empty;
    public string UserName { get; set; } = string.Empty;
    public string UserPassword { get; set; } = string.Empty;
    public string WsdlUrl { get; set; } = string.Empty;
    public string CallbackPath { get; set; } = "/payments/callback/mellat";
}

public sealed class ZarinPalOptions
{
    public bool Enabled { get; set; }
    public PaymentProviderEnvironment Environment { get; set; } = PaymentProviderEnvironment.Disabled;
    public string MerchantId { get; set; } = string.Empty;
    public bool UseSandbox { get; set; } = true;
    public string RequestUrl { get; set; } = string.Empty;
    public string VerifyUrl { get; set; } = string.Empty;
    public string StartPayBaseUrl { get; set; } = string.Empty;
    public string CallbackPath { get; set; } = "/payments/callback/zarinpal";
}

public sealed class ZibalOptions
{
    public bool Enabled { get; set; }
    public PaymentProviderEnvironment Environment { get; set; } = PaymentProviderEnvironment.Disabled;
    public string MerchantId { get; set; } = string.Empty;
    public string RequestUrl { get; set; } = "https://gateway.zibal.ir/v1/request";
    public string VerifyUrl { get; set; } = "https://gateway.zibal.ir/v1/verify";
    public string StartPayBaseUrl { get; set; } = "https://gateway.zibal.ir/start/";
    public string CallbackPath { get; set; } = "/payments/callback/zibal";
}

public interface IPaymentProviderRegistry
{
    IPaymentProvider? Get(string code);
    IReadOnlyCollection<IPaymentProvider> GetAll();
}

public sealed class PaymentProviderRegistry(IEnumerable<IPaymentProvider> providers) : IPaymentProviderRegistry
{
    private readonly IReadOnlyDictionary<string, IPaymentProvider> _providers = providers.ToDictionary(p => p.Code, StringComparer.OrdinalIgnoreCase);
    public IPaymentProvider? Get(string code) => _providers.TryGetValue(code, out var p) ? p : null;
    public IReadOnlyCollection<IPaymentProvider> GetAll() => _providers.Values.ToList();
}

public interface IPaymentAmountConverter
{
    MoneyAmount ToProviderAmount(MoneyAmount original, string providerCode);
}

public sealed class PaymentAmountConverter : IPaymentAmountConverter
{
    // Central boundary. Default: providers receive same currency/amount as original (Toman/IRT).
    // Explicit per-provider conversion can be added when official contract requires Rial; never implicit double-x10.
    public MoneyAmount ToProviderAmount(MoneyAmount original, string providerCode)
    {
        if (original.Amount < 0) throw new ArgumentOutOfRangeException(nameof(original));
        return original with { Amount = decimal.Round(original.Amount, 0, MidpointRounding.AwayFromZero) };
    }
}
