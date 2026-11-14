# AbrIT Portal — Phase 2 baseline (2026-11-09)

## Environment and isolation

- Source tenant: `Default` in `AbrITPortal/App_Data/tenants.json`.
- Original PostgreSQL database: `orchard_db`. It was only queried with `default_transaction_read_only=on` during audit and comparison. No application launch or migration was run against it.
- Required local files: `AbrITPortal/appsettings.json`, `AbrITPortal/NLog.config`, `AbrITPortal/Properties/launchSettings.json`, `AbrITPortal/App_Data/tenants.json`, `AbrITPortal/App_Data/Sites/Default/appsettings.json`, DataProtection keys, Lucene files, and status. The runtime files and secrets stay outside Git.
- Backup: `C:\Users\m.shekofteh\AbrITPortalBackups\phase2-20261109-110512`. Its ACL permits the current user and SYSTEM. It includes the compatible PostgreSQL 14.24 custom archive, tenant settings, keys, Lucene data, and host configuration.
- Compatible archive: `original-pg14.pgdump`, SHA-256 `D353D0988886B0A3EBE407F4F0E855A0C048F9FEF0405A8F2A48161FCF5D5FD9`. `pg_restore --list` succeeded. Restore into `abrit_portal_dev_20261109_110512` completed, and counts plus content fingerprints matched for all 12 public tables. See `verification.txt` in the backup directory.
- The first dump used PostgreSQL client 18.2 and could not be restored to server 14.24 because of `transaction_timeout`. It is retained as `original.pgdump`; use the 14.24 archive above for restore.
- Development tenant files live under ignored `artifacts/development/App_Data`. Both launch profiles set `ORCHARD_APP_DATA=../artifacts/development/App_Data`. `DevelopmentEnvironment` refuses a missing/wrong path, other tenant names, or a database outside the `abrit_portal_dev_` namespace. It pins Orchard's shell path to that copy. The maintenance command checks the resolved shell connection again.

The copied tenant currently uses the existing PostgreSQL login. Credentials are kept only in ACL-restricted, ignored local files. A dedicated development login with permissions limited to the development database remains recommended before shared development.

## Build baseline

`dotnet build AbrITPortal.slnx --no-restore` succeeded before implementation: 0 errors, 13 NU1902/NU1903 warnings. Logs: ignored `artifacts/development/baseline-build.txt`.

A running `AbrITPortal.exe` locked the default output during the first subsequent build. The running process was left alone; all later builds used `--artifacts-path artifacts/build`. Final isolated build: 0 errors, 23 transitive advisory warnings across three projects. A prior full build also emitted ASP0000 for the isolated test harness. Logs: `artifacts/development/final-build.txt`.

Direct NuGet references are OrchardCore.Application.Cms.Targets 3.0.1 and OrchardCore.Logging.NLog 3.0.1 in the host, and OrchardCore.Theme.Targets and ContentManagement/DisplayManagement/ResourceManagement 3.0.1 in the theme. No package versions changed.

| Transitive package | Version(s) in assets | Advisory severity | Immediate parent examples |
| --- | --- | --- | --- |
| AngleSharp | 1.4.0 | Moderate | OrchardCore.Application.Cms.Targets, HtmlSanitizer |
| MySqlConnector | 2.4.0 | Moderate | YesSql.Provider.MySql |
| SixLabors.ImageSharp | 3.1.11 | Moderate, high | SixLabors.ImageSharp.Web |
| System.Security.Cryptography.Pkcs | 10.0.7 (host), 9.0.4 (theme asset) | Moderate, high | Microsoft.Data.SqlClient, MimeKit |

NuGet advisory URLs and exact warning occurrences are in the build logs. A compatibility review is required before upgrading any package.

## Development commands

From repository root, PowerShell:

```powershell
dotnet build AbrITPortal.slnx --artifacts-path artifacts/build
dotnet run --project AbrITPortal.SecurityTests/AbrITPortal.SecurityTests.csproj --no-build --artifacts-path artifacts/build
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:ORCHARD_APP_DATA = '../artifacts/development/App_Data'
dotnet run --project AbrITPortal/AbrITPortal.csproj --no-build --no-launch-profile --artifacts-path artifacts/build -- --abrit-maintenance
```

The explicit maintenance command updates the existing `MyOrders` query source, repairs the service Query JSON and `search` profile name, rebuilds only the cloned Lucene index, and checks the returned service/order counts. It is not part of ordinary startup. Re-running it rebuilds only the development index.

Verified after maintenance: catalog query returned 1 service; order query returned 0 for anonymous, 1 for the stable owner of the existing order, and 0 for an unrelated identifier even when the caller supplied the owner's ID as a query parameter.

No payment gateway, Nextcloud call, tenant reset, production deployment, Git commit, or push occurred.

## Phase 3 baseline (2026-11-09)

- Isolation remains the Phase 2 PostgreSQL clone `abrit_portal_dev_20261109_110512`; the original database was not targeted. The Phase 2 verified backup remains at `C:\Users\m.shekofteh\AbrITPortalBackups\phase2-20261109-110512`.
- `dotnet build AbrITPortal.slnx --artifacts-path artifacts/build --no-restore -v quiet`: 0 errors, 23 warnings. The warnings are the existing NU1902/NU1903 transitive package advisories and ASP0000 in the standalone test harness; no dependency was upgraded without compatibility analysis.
- `dotnet run --project AbrITPortal.SecurityTests/AbrITPortal.SecurityTests.csproj --no-build --artifacts-path artifacts/build`: 43 assertions, 0 failures. This includes the original order security checks, public catalog regression, dashboard access metadata, and A/B dashboard output validation.
- Loopback HTTP against the development tenant: `/services` 200 with one service card and no fake checkout link; anonymous `/dashboard` 302 to `/Login`; unknown `/services/{id}` 404; `/Register`, `/Login`, `/ForgotPassword` 200; anonymous `/ChangeEmail` 302 to login. A random development-only account registration returned 302 and produced one local confirmation message. A second random account was confirmed through local pickup, then authenticated `/dashboard` and `/account` returned 200. The native logout POST returned a logged-out session that redirected dashboard access to Login. The forgot-password request produced a local reset email; reset POST returned 200 and login with the new password reached dashboard 200.
- The development email transport is an Orchard SMTP pickup directory under ignored `artifacts/development/App_Data/Sites/Default/Emails`. It does not call an external SMTP service. Production delivery needs administrator-provided SMTP settings and a sender domain.

## Phase 5 baseline (2026-11-09) — AbrIT Drive status integration

- Isolation unchanged: Phase 2 PostgreSQL clone and the `abrit_portal_dev_` namespace guard remain in force; the original database was not touched. Build: `dotnet build AbrITPortal.slnx --artifacts-path artifacts/build --no-restore -v quiet` — 0 errors, 23 known transitive advisory warnings. Security harness: 72 assertions, 0 failures (the 43 previous checks plus 29 new Drive checks).
- New code: `AbrITPortal/Drive/AbrITDriveOptions.cs` (options, `DriveState` enum, `DriveStatus` record), `DriveStatusService.cs` (WebDAV PROPFIND/MKCOL client over a single technical account), `DriveController.cs` (`/drive` page and `/drive/provision` POST). `Program.cs` registers the options and a typed HttpClient with `PooledConnectionLifetime` 2 min / idle timeout 30 s so a restarted Drive server cannot poison pooled keep-alive connections indefinitely. Dashboard now renders the real Drive card via `DriveViews.Card`; sidebar gained an AbrIT Drive link. No query, authorization or order logic changed.
- Configuration comes from the `AbrITDrive` section (Enabled, BaseUrl, Username, AppPassword, DavPath, CustomerRoot, TimeoutSeconds 1..30, CacheSeconds 0..600, AllowInsecure). Credentials are provided per environment (appsettings.Production.json / user secrets / environment variables) and are never committed; the working development setup passes them as environment variables to the local process only.
- Development validation environment: embedded PostgreSQL (`artifacts/development/pgdata`, port 5433) and a local Python mock WebDAV server on 127.0.0.1:5081 (`scripts/mock_webdav.py`, Nextcloud stand-in serving RFC 4331 quota properties). The portal ran with `ASPNETCORE_ENVIRONMENT=Development`, `ORCHARD_APP_DATA=../artifacts/development/App_Data` and `AbrITDrive__*` variables pointing at the mock. The mock is a test double only; production targets the real Nextcloud host over HTTPS.
- The mock exposed a classic BaseHTTPRequestHandler trap: an unread PROPFIND body survives on a keep-alive connection and corrupts the next request (the portal received 400 for MKCOL). Fixed by consuming `Content-Length` bytes in the dev mock; the portal code was correct throughout — the in-process harness server (Kestrel) never showed the issue.
- Real-browser validation (Playwright, `scripts/validate_drive_ui.py`): 14 checks, 0 failures — dev fixture login, missing state offering provisioning, browser-driven activation POST reaching the mock (MKCOL 201, redirect to `/drive?provisioned=1`), success notice, ready state with real quota numbers and progress bar, no credential or internal folder-name leak, dashboard card present with real status, mobile layout, anonymous `/drive` redirected to `/Login?ReturnUrl=%2Fdrive`. Screenshots: `docs/ui-review/12-drive-activate-desktop.png`, `13-drive-ready-desktop.png`, `14-dashboard-drive-desktop.png`, `15-drive-mobile.png`.
- Direct file upload/download through the portal remains deliberately out of scope and is marked as under development; files stay accessible only through the customer's own Drive (Nextcloud) client. No fake success state exists: NotConfigured, Unreachable, Missing and Ready are all rendered from real server responses.
- Deployment hardening for reverse-proxy preview: the app now honors `X-Forwarded-Proto` (loopback only) and rewrites any absolute `Location` it produces back to a relative path+query, so authentication challenges stay on the public scheme behind the sandbox gateway. Security harness re-run: 72/72 PASS; gateway-path browser walk (catalog, login with ReturnUrl, drive, dashboard, account): 6/6 PASS.
