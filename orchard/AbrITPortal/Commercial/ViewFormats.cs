using System.Globalization;

namespace AbrITPortal.Commercial;

/// <summary>
/// Display formatting for commerce values rendered inside the RTL admin.
/// ISO-8601 timestamps with milliseconds are machine formats — the admin
/// shows them as compact UTC stamps (readable, unambiguous, still LTR-safe).
/// </summary>
public static class ViewFormats
{
    private static readonly string[] IsoPatterns =
    {
        "yyyy-MM-dd\\THH:mm:ss.fffZ",
        "yyyy-MM-dd\\THH:mm:ssZ",
        "yyyy-MM-dd\\THH:mm:ss.fffffffZ",
        "yyyy-MM-dd HH:mm:ss",
        "yyyy-MM-ddTHH:mm:ss.fffzzz",
    };

    public static string CompactDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value == "—") return "—";
        if (DateTimeOffset.TryParseExact(value, IsoPatterns, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal, out var dto))
        {
            return dto.ToUniversalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
        }
        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out dto))
        {
            return dto.ToUniversalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
        }
        return value;
    }
}
