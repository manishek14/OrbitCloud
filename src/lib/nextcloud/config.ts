// Nextcloud connection configuration (server-side only).
//
// Two modes:
//  - "live":       talks to the real Orbit Drive at https://drive.abrit.cloud.
//                 Requires NEXTCLOUD_ADMIN_USER / NEXTCLOUD_ADMIN_APP_PASSWORD
//                 (an app password created in Nextcloud: Settings → Security).
//  - "simulation": talks to the bundled Nextcloud emulator mini-service
//                 (mini-services/nextcloud-mock, port 3031) which speaks the
//                 same OCS protocol, so the whole flow can be demonstrated and
//                 tested without production credentials.
//
// Credentials never reach the frontend and are never committed; they come from
// environment variables (mirroring the Orchard portal's AbrITDriveOptions).

export type NextcloudMode = "live" | "simulation";

export interface NextcloudConfig {
  mode: NextcloudMode;
  baseUrl: string;
  adminUser: string;
  adminPassword: string;
  timeoutMs: number;
  loginUrl: string;
  allowInsecure: boolean;
  /** True when the integration has everything it needs to place a call. */
  configured: boolean;
}

const SIM_BASE_URL = "http://127.0.0.1:3031";
const SIM_ADMIN_USER = "orbit-portal-admin";
const SIM_ADMIN_PASSWORD = "orbit-simulation-app-password";

function env(key: string, fallback = ""): string {
  const value = process.env[key];
  return value === undefined || value === null ? fallback : value.trim();
}

export function getNextcloudConfig(): NextcloudConfig {
  const rawMode = env("NEXTCLOUD_MODE", "simulation").toLowerCase();
  const mode: NextcloudMode = rawMode === "live" ? "live" : "simulation";
  const timeoutMs = Math.min(60000, Math.max(1000, Number(env("NEXTCLOUD_TIMEOUT_MS", "8000")) || 8000));
  const allowInsecure = env("NEXTCLOUD_ALLOW_INSECURE", "false").toLowerCase() === "true";
  const isProduction = process.env.NODE_ENV === "production";

  if (mode === "simulation") {
    // PRODUCTION GUARD (spec §10.2): simulation may exist ONLY in isolated
    // development. In production a non-live mode is a clear configuration
    // failure — never silently create fake accounts on the operational path.
    if (isProduction) {
      throw new Error(
        "NEXTCLOUD configuration failure: NEXTCLOUD_MODE=simulation is not allowed in production. " +
          "Set NEXTCLOUD_MODE=live with NEXTCLOUD_BASE_URL=https://drive.abrit.cloud and real admin credentials.",
      );
    }
    return {
      mode,
      baseUrl: env("NEXTCLOUD_BASE_URL", SIM_BASE_URL).replace(/\/+$/, ""),
      adminUser: env("NEXTCLOUD_ADMIN_USER", SIM_ADMIN_USER),
      adminPassword: env("NEXTCLOUD_ADMIN_APP_PASSWORD", SIM_ADMIN_PASSWORD),
      timeoutMs,
      // Relative URL on the preview origin; the gateway routes it to the mock.
      loginUrl: env("DRIVE_LOGIN_URL", "/login?XTransformPort=3031"),
      allowInsecure: true, // internal loopback service, never leaves the host
      configured: true,
    };
  }

  const baseUrl = env("NEXTCLOUD_BASE_URL", "https://drive.abrit.cloud").replace(/\/+$/, "");
  const adminUser = env("NEXTCLOUD_ADMIN_USER");
  const adminPassword = env("NEXTCLOUD_ADMIN_APP_PASSWORD");
  const httpsOk = baseUrl.startsWith("https://");
  // Production guard (audit §5.3): NEXTCLOUD_ALLOW_INSECURE is a DEVELOPMENT
  // override — it can never weaken production. Basic admin credentials must
  // not travel over plain HTTP when NODE_ENV=production.
  const allowInsecureEffective = isProduction ? false : allowInsecure;
  if (isProduction && allowInsecure) {
    console.warn(
      "[nextcloud] NEXTCLOUD_ALLOW_INSECURE=true is ignored in production — " +
        "the Nextcloud base URL must be HTTPS.",
    );
  }
  // Production guard: Basic credentials must never travel over plain HTTP.
  const configured = Boolean(baseUrl) && Boolean(adminUser) && Boolean(adminPassword) && (httpsOk || allowInsecureEffective);
  return {
    mode,
    baseUrl,
    adminUser,
    adminPassword,
    timeoutMs,
    loginUrl: env("DRIVE_LOGIN_URL", "https://drive.abrit.cloud/login"),
    allowInsecure: allowInsecureEffective,
    configured,
  };
}
