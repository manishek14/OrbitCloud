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

    // Persian digit unification (audit UI-6): money/quantity columns in the
    // RTL admin render with fa-IR digits (۱۲٬۹۵۰٬۰۰۰) so tables never mix
    // Latin and Persian numeral systems in adjacent columns. .NET ToString
    // never substitutes native digits by culture, so digits are translated
    // explicitly (U+06F0..U+06F9).
    private static readonly CultureInfo FaIr = new("fa-IR");

    internal static string ToFaDigits(string text) =>
        string.Concat(text.Select(c => c is >= '0' and <= '9' ? (char)('\u06F0' + (c - '0')) : c));

    /// <summary>1234500 → «۱۲٬۲۳۴٬۵۰۰» (Persian digits + Persian thousands separator).</summary>
    public static string FaToman(decimal value) => ToFaDigits(value.ToString("N0", FaIr));

    /// <summary>Integer quantities with Persian digits.</summary>
    public static string FaNumber(int value) => ToFaDigits(value.ToString(FaIr));
}
