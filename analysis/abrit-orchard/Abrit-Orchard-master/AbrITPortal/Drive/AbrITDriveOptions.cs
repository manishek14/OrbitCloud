using Microsoft.Extensions.Options;

namespace AbrITPortal.Drive;

/// <summary>
/// Configuration for the AbrIT Drive (Nextcloud/WebDAV) integration. Secrets are
/// provided per environment (appsettings.Production.json / user secrets / env vars)
/// and are never committed to Git nor rendered into any customer-facing page.
/// </summary>
public sealed class AbrITDriveOptions
{
    /// <summary>Master switch. When false the portal shows the honest "not connected" state.</summary>
    public bool Enabled { get; set; }

    /// <summary>Nextcloud origin, e.g. "https://cloud.abrit.ir". No trailing slash, no path.</summary>
    public string BaseUrl { get; set; } = "";

    /// <summary>Technical Nextcloud account used by the portal (not a customer account).</summary>
    public string Username { get; set; } = "";

    /// <summary>App password/token of the technical account (Nextcloud: Settings → Security).</summary>
    public string AppPassword { get; set; } = "";

    /// <summary>WebDAV files endpoint of the Nextcloud instance.</summary>
    public string DavPath { get; set; } = "/remote.php/dav/files";

    /// <summary>Folder inside the technical account holding one folder per customer.</summary>
    public string CustomerRoot { get; set; } = "AbrITPortal";

    /// <summary>Per-request WebDAV timeout in seconds (clamped 1..30).</summary>
    public int TimeoutSeconds { get; set; } = 5;

    /// <summary>How long a customer's status is cached on the dashboard path.</summary>
    public int CacheSeconds { get; set; } = 60;

    /// <summary>
    /// Production guard: credentials are never sent over plain HTTP. Keep false in
    /// production; only Development environments (or an explicit opt-in) may use http.
    /// </summary>
    public bool AllowInsecure { get; set; }
}

public enum DriveState { NotConfigured, Unreachable, Missing, Ready }

/// <summary>Server-side view of one customer's AbrIT Drive folder. Carries no credentials.</summary>
public sealed record DriveStatus(DriveState State, long? UsedBytes = null, long? TotalBytes = null, string? Detail = null)
{
    public bool IsReady => State == DriveState.Ready;
}
