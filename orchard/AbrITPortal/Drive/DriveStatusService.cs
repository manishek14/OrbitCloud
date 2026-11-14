using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace AbrITPortal.Drive;

/// <summary>
/// Talks to the customer-facing AbrIT Drive (Nextcloud) over WebDAV using a single
/// technical account. One private folder is provisioned per portal user; its name is
/// a SHA-256 fragment of the stable user id so raw identifiers, usernames or phone
/// numbers never leave the portal. All calls are server-side: the customer never
/// receives (or needs) Drive credentials, and every rendered status is real server
/// data — the portal never fakes a connected or provisioned state.
/// </summary>
public sealed class DriveStatusService(
    HttpClient http,
    IOptions<AbrITDriveOptions> optionsAccessor,
    IMemoryCache cache,
    IWebHostEnvironment environment)
{
    private readonly AbrITDriveOptions _options = optionsAccessor.Value;

    /// <summary>Stable, privacy-preserving folder name; the raw user id never reaches Drive.</summary>
    public static string FolderName(string userId) =>
        "u-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(userId))).ToLowerInvariant()[..16];

    /// <summary>True when the integration is switched on with a usable origin and credentials.</summary>
    public bool IsConfigured =>
        _options.Enabled &&
        Uri.TryCreate(_options.BaseUrl, UriKind.Absolute, out var baseUri) &&
        baseUri.Scheme is "http" or "https" &&
        baseUri.PathAndQuery is "/" or "" &&
        !string.IsNullOrWhiteSpace(_options.Username) &&
        !string.IsNullOrWhiteSpace(_options.AppPassword);

    // Production guard: Basic credentials must never travel over plain HTTP.
    private bool SecureEnough =>
        _options.BaseUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
        environment.IsDevelopment() || _options.AllowInsecure;

    public async Task<DriveStatus> GetStatusAsync(ClaimsPrincipal user, CancellationToken cancellation = default)
    {
        var userId = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return new(DriveState.Unreachable, Detail: "شناسه کاربر معتبر نیست.");
        return await GetStatusAsync(userId, cancellation);
    }

    public async Task<DriveStatus> GetStatusAsync(string userId, CancellationToken cancellation = default)
    {
        if (!IsConfigured) return new(DriveState.NotConfigured);
        if (!SecureEnough) return new(DriveState.Unreachable, Detail: "آدرس Drive باید در محیط عملیاتی روی HTTPS باشد.");
        var folder = FolderName(userId);
        return (await cache.GetOrCreateAsync("abrit-drive:" + userId, async entry =>
        {
            entry.AbsoluteExpiration = DateTimeOffset.UtcNow.AddSeconds(Math.Clamp(_options.CacheSeconds, 0, 600));
            try
            {
                using var request = Propfind(folder);
                using var response = await http.SendAsync(request, cancellation);
                return Interpret(response.StatusCode, await ReadBody(response, cancellation));
            }
            catch (Exception ex)
            {
                // Detail is static on purpose: exception text may carry infrastructure data.
                return new(DriveState.Unreachable, Detail: "سرور Drive در دسترس نیست.");
            }
        })) ?? new(DriveState.Unreachable, Detail: "سرور Drive در دسترس نیست.");
    }

    /// <summary>Creates the customer's Drive folder (idempotent) and returns the fresh status.</summary>
    public async Task<DriveStatus> EnsureFolderAsync(string userId, CancellationToken cancellation = default)
    {
        if (!IsConfigured) return new(DriveState.NotConfigured);
        if (!SecureEnough) return new(DriveState.Unreachable, Detail: "آدرس Drive باید در محیط عملیاتی روی HTTPS باشد.");
        var folder = FolderName(userId);
        try
        {
            using (var customer = Mkcol(folder))
            using (var response = await http.SendAsync(customer, cancellation))
            {
                // 409 means the parent tree is missing; create it once and retry.
                if (response.StatusCode == HttpStatusCode.Conflict)
                {
                    using var root = MkcolRoot();
                    using var rootResponse = await http.SendAsync(root, cancellation);
                    if (rootResponse.StatusCode is not (HttpStatusCode.Created or HttpStatusCode.MethodNotAllowed))
                        return new(DriveState.Unreachable, Detail: "ایجاد پوشه اصلی Drive ممکن نشد.");
                    using var retry = Mkcol(folder);
                    using var retryResponse = await http.SendAsync(retry, cancellation);
                    if (retryResponse.StatusCode is not (HttpStatusCode.Created or HttpStatusCode.MethodNotAllowed))
                        return new(DriveState.Unreachable, Detail: "ایجاد فضای شما در Drive ممکن نشد.");
                }
                else if (response.StatusCode is not (HttpStatusCode.Created or HttpStatusCode.MethodNotAllowed))
                {
                    return new(DriveState.Unreachable, Detail: "ایجاد فضای شما در Drive ممکن نشد.");
                }
            }
        }
        catch (Exception)
        {
            return new(DriveState.Unreachable, Detail: "سرور Drive در دسترس نیست.");
        }
        cache.Remove("abrit-drive:" + userId);
        return await GetStatusAsync(userId, cancellation);
    }

    private HttpRequestMessage Propfind(string folder)
    {
        var request = new HttpRequestMessage(new HttpMethod("PROPFIND"), Url(folder))
        {
            Content = new StringContent(
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
                "<d:propfind xmlns:d=\"DAV:\"><d:prop><d:quota-used-bytes/><d:quota-available-bytes/></d:prop></d:propfind>",
                Encoding.UTF8, "application/xml")
        };
        Authorize(request);
        return request;
    }

    private HttpRequestMessage Mkcol(string folder)
    {
        var request = new HttpRequestMessage(new HttpMethod("MKCOL"), Url(folder));
        Authorize(request);
        return request;
    }

    private HttpRequestMessage MkcolRoot()
    {
        var request = new HttpRequestMessage(new HttpMethod("MKCOL"), Url(null));
        Authorize(request);
        return request;
    }

    private string Url(string? folder)
    {
        var origin = _options.BaseUrl.TrimEnd('/');
        var dav = _options.DavPath.StartsWith('/') ? _options.DavPath : "/" + _options.DavPath;
        var root = _options.CustomerRoot.Trim('/');
        var path = $"{dav}/{Uri.EscapeDataString(_options.Username)}";
        if (root.Length > 0) path += "/" + root;
        if (folder is not null) path += "/" + folder;
        return origin + path + "/";
    }

    private void Authorize(HttpRequestMessage request)
    {
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic",
            Convert.ToBase64String(Encoding.UTF8.GetBytes(_options.Username + ":" + _options.AppPassword)));
        request.Headers.TryAddWithoutValidation("Depth", "0");
    }

    private static async Task<string?> ReadBody(HttpResponseMessage response, CancellationToken cancellation)
    {
        try { return await response.Content.ReadAsStringAsync(cancellation); }
        catch { return null; }
    }

    /// <summary>Pure WebDAV interpretation; public so the security harness can test it directly.</summary>
    public static DriveStatus Interpret(HttpStatusCode code, string? body)
    {
        if (code == HttpStatusCode.MultiStatus)
        {
            var (used, total) = Quota(body);
            return new(DriveState.Ready, used, total);
        }
        return code switch
        {
            HttpStatusCode.NotFound => new(DriveState.Missing),
            HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden =>
                new(DriveState.Unreachable, Detail: "اعتبارنامه Drive پذیرفته نشد."),
            _ => new(DriveState.Unreachable, Detail: "پاسخ نامعتبر از سرور Drive (کد " + (int)code + ").")
        };
    }

    internal static (long? Used, long? Total) Quota(string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return (null, null);
        try
        {
            var document = XDocument.Parse(body);
            var usedNode = document.Descendants(XName.Get("quota-used-bytes", "DAV:")).FirstOrDefault();
            var availableNode = document.Descendants(XName.Get("quota-available-bytes", "DAV:")).FirstOrDefault();
            long? used = usedNode is not null && long.TryParse(usedNode.Value, out var u) ? u : null;
            long? total = availableNode is not null && long.TryParse(availableNode.Value, out var a) && used is not null
                ? used + a
                : null;
            return (used, total);
        }
        catch
        {
            return (null, null);
        }
    }
}
