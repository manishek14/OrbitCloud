# UI Redesign Notes (merged)

## 2026-11-10 review (Phase 5 branch notes)

# AbrIT Portal UI review — 2026-11-10

## Scope

The customer-facing portal uses the existing Orchard Core 3.0.1, .NET 10, `AllServices` and `MyOrders` queries, native login, and existing mobile registration controller. Order ownership and authorization code was not changed for this UI update.

The theme now has a Persian RTL header, navigation, footer, responsive cards, forms, dashboard panels, sidebar, tables, status labels, and empty states. The legacy `Page-UserDashboard.liquid` shape also uses this layout if Orchard renders it from content. Vazirmatn v33.003 is served locally from `AbrITPortalTheme/wwwroot/fonts/`; its SIL OFL license is included beside the font. CSS is scoped to the customer theme and portal markup.

The native Orchard login view and form shape are overridden in the theme. They keep the Orchard login action, field names, antiforgery token, return URL, and external provider section. Login validation messages shown by the override are Persian. The registration link uses the implemented `/customer/register` route: the cloned tenant returned 404 for `/Register` during this review. Registration keeps the existing mobile verification backend and now presents invalid input in the branded form.

`/portal` now redirects authenticated users to `/dashboard`; anonymous users are sent to login by authorization. `/services/{id}` uses a published service from `AllServices`. Checkout controls remain disabled. The dashboard still accepts only published orders owned by the authenticated stable user ID and shows counts, service statuses, recent orders, and a Drive disconnected state from actual data.

## Verification

- Full solution build: 0 errors, 23 warnings. Warnings are existing NuGet advisories and the standalone test-harness analyzer warning; dependency versions were not changed. A direct OrchardCore.Users 3.0.1 reference was added in the theme for the login override.
- Security harness: 43 assertions passed, 0 failed.
- Loopback HTTP on the isolated development tenant: `/services` 200, `/Login` 200, `/customer/register` 200, `/ForgotPassword` 200, anonymous `/dashboard` and `/account` 302, `/portal` 302, unknown service 404. Invalid login POST reached the native action and returned the Persian error UI. An invalid registration POST returned 400 with the branded Persian error and form; no account was created.
- Browser screenshots were captured with Edge headless at 1440, 1024, 768, and a DevTools-emulated **390 CSS pixel** viewport. The 390 screenshots of services, login, and registration show no clipped controls or horizontal overflow in the visible viewport.

## Screenshot evidence

- Catalog: `ui-review/services-1440.png`, `services-1024.png`, `services-768.png`, `services-390.png`.
- Login: `ui-review/login-1440.png`, `login-390.png`.
- Registration: `ui-review/register-1440.png`, `register-390.png`.
- Service detail: `ui-review/service-detail-1440.png`.

## Remaining visual coverage

Authenticated dashboard and account pages were not captured in a browser because no existing test account credentials were available for this run. Their server-side authorization and data isolation are covered by the security harness, but their rendered appearance still needs an authenticated browser review. No production database or existing user account was modified for visual testing.

---

# AbrIT Portal — Phase 4 UI redesign (2026-11-09)

Implementation notes and validation results for the customer portal UI redesign.
Scope: front-end only. No authorization, query, or data logic was weakened; the
build (0 errors) and the full security test harness (43 assertions, 0 failures)
pass after the redesign.

## Design direction

Premium Persian-first enterprise SaaS look, fully RTL, on the AbrIT brand:

| Token | Value | Usage |
| --- | --- | --- |
| Navy | `#101A30` | Headings, footer, hero/auth panels, primary text |
| Blue | `#1769FF` | Primary actions, links, active nav, focus rings |
| Light Blue | `#EAF2FF` | Secondary buttons, icon chips, active nav background |
| Background | `#F5F7FB` | Page background |
| White | `#FFFFFF` | Cards, panels, header |

The design system lives in `AbrITPortalTheme/wwwroot/css/abrit-portal.css`
(rewritten): brand tokens, status colors, radii/shadows, typography, and all
components (header/nav, footer, stat cards, panels, tables, badges, service
cards, price cards, dashboard hero, dash sidebar, auth cards, forms, alerts,
empty states). Typography uses self-hosted Vazirmatn (5 weights, OFL license,
in `AbrITPortalTheme/wwwroot/fonts/`) — no CDN dependency. Numbers rendered by
the portal controllers use `fa-IR` culture (Persian digits). Responsive
breakpoints at 1024/880/720/560/400 px; mobile navigation uses a no-JS
checkbox pattern. No frontend framework was introduced; no Bootstrap.

## Architecture kept

The real customer routes are served by `PortalController` (`/dashboard`,
`/account`, `/services`, `/services/{id}`) and `MobileIdentityController`
(`/customer/register`, `/customer/mobile`, `/customer/recover`) which render
server-side HTML. The redesign rebuilt their HTML output against the shared
shell in the new `AbrITPortal/Pages/PortalShell.cs` (brand mark, sticky header,
nav, mobile menu, footer, styled error pages), so every portal page now shares
one consistent shell. All security-relevant code paths are unchanged:

- `[Authorize]` on Dashboard/Account, `[AllowAnonymous]` on Catalog/Service.
- `CanDisplayOrders`, the `MyOrders` re-check at the display boundary, 503
  behavior when queries are missing, and every `WebUtility.HtmlEncode` escape.
- Antiforgery-protected logout (`/Users/LogOff`) and all OTP forms
  (`__RequestVerificationToken`), identical field names and endpoints.
- The Liquid theme files keep the same data bindings (`Queries.AllServices`,
  `Queries.MyOrders | query`); the catalog templates still contain no order
  query and no fake checkout action (asserted by the test harness).

## Pages delivered

1. **Global layout & navigation** — shared shell for controller pages
   (`PortalShell.Render`) and CMS pages (`Layout.liquid`); brand, RTL nav with
   active state, authenticated user chip, logout, mobile burger menu, navy
   footer. New `Layout-Login.liquid` provides the same shell for native
   Orchard account pages (`Layout__Login` shape alternate).
2. **Customer login** — native `/Login` (Orchard Users) styled through the
   theme shell + global form styling. See "Remaining issues" for the
   `UseSiteTheme` setting.
3. **Customer registration** — `/customer/register` (SMS OTP flow) fully
   redesigned as a branded auth card; verify-code screens styled; native
   `/Register` remains available when the Registration feature is enabled.
4. **Services catalog** — `/services` (controller) and the
   `Content-ServiceCatalogPage.Detail.liquid` / `Content-AbrITService.List.liquid`
   CMS templates: card grid with icon, price, details link, and an honest
   "ثبت سفارش آنلاین در حال آماده‌سازی است / به‌زودی" notice. No fake checkout.
5. **Service details** — `/services/{id}` + `Content-AbrITService.Detail.liquid`:
   detail panel + sticky price card with disabled "ثبت سفارش به‌زودی" button.
   Unknown ids render the branded 404 (`PortalShell.ErrorPage`).
6. **Customer dashboard** — `/dashboard`: navy welcome hero, four stat cards
   (کل سفارش‌ها، سرویس‌های فعال، در انتظار، تکمیل‌شده — computed from the same
   status classification as before, Persian digits), "سرویس‌های من" panel,
   recent-orders table (mono order id, service, date, price, status badge,
   display link), and the AbrIT Drive status card (متصل نیست — honest state;
   no fake drive data).
7. **Account profile** — `/account`: personal info grid (username, email,
   phone, verified badge), links to `/customer/mobile`, `/ChangeEmail`,
   `/ChangePassword`.
8. **My orders / my services** — both live inside the dashboard panels, backed
   only by the `MyOrders` query and ownership checks. The Liquid fallback page
   (`Page-UserDashboard.liquid`) mirrors the same sections for the CMS page.
9. **Empty & error states** — empty catalog/orders/services states, styled 400
   error pages for invalid OTP/validation failures, branded 404 for unknown
   services, Orchard validation summary styling for native forms.

All navigation links point to real routes only (`/services`, `/dashboard`,
`/account`, `/customer/register`, `/customer/mobile`, `/customer/recover`,
`/Login`, `/ChangeEmail`, `/ChangePassword`, `/Users/LogOff`,
`/Contents/Item/Display/{id}`). The former header link set did not reference
`/portal`; nothing needed removal there.

## Validation (actual runs, 2026-11-09)

- `dotnet build AbrITPortal.slnx --artifacts-path artifacts/build --no-restore`:
  **0 errors**, 25 warnings (the pre-existing NU1902/NU1903 transitive
  advisories and ASP0000 in the standalone harness; no dependency changed).
- `dotnet run --project AbrITPortal.SecurityTests/...`: **43 assertions,
  0 failures**.
- Real browser validation (Orchard 3.0.1, .NET 10, PostgreSQL 14.24 embedded,
  Development isolation per BASELINE): completed Orchard setup, enabled the
  theme/features, defined `AbrITService`/`AbrITOrder` content types, created
  the `MyOrders` (AbrITOrders source) and `AllServices` queries, seeded one
  real service item and two published orders owned by a dedicated customer
  user via the admin UI, then captured `docs/ui-review/*.png`:
  - `01` catalog (desktop, anonymous), `02` service detail (desktop),
    `03` native login, `04` OTP registration, `05` password recovery,
    `06` branded 404, `07` dashboard, `08` account, `09` mobile management
    (desktop, customer session), `10` catalog and `11` dashboard at 390×844.
- Verified HTTP behaviors during validation: anonymous `/dashboard` → 302 to
  `/Login`; `/services` public with real data; unknown `/services/{id}` →
  styled 404; login with the customer account reached `/dashboard` with the
  correct per-user order data.

## Remaining issues

1. **Native account pages and the site theme.** `Login-Settings → "Use site
   theme for login page"` (`LoginSettings.UseSiteTheme`) must be enabled
   (admin UI: Settings → Users, or the documented `--abrit-identity-setup`
   command) so `/Login`, `/ForgotPassword`, `/Register` render inside the site
   theme shell (`Layout-Login.liquid` ships with this theme). In the validation
   sandbox the setting was persisted but the account pages still rendered with
   the admin theme — verify on the development environment after running
   `--abrit-identity-setup`.
2. **`--abrit-identity-setup` re-run deadlock (found during validation).** When
   the mobile-uniqueness partial index does not exist yet,
   `EnsureMobileUniquenessAsync` can time out because `CREATE UNIQUE INDEX`
   waits on the same shell scope's open YesSql transaction. Creating the index
   out-of-band once (or moving the command before settings save) resolves it;
   re-runs then complete because of `IF NOT EXISTS`.
3. **Lucene query admin** (`Queries → New Lucene query`) throws
   `ArgumentNullException('source')` on save in Orchard Core 3.0.1 in this
   environment; `AllServices` was therefore created as a SQL query for
   validation. The production database already holds the Lucene-based
   `AllServices`; no product code depends on the query source type.
4. The Orchard default `The page could not be found.` page (root `/` without a
   home route) is not themed; configure a homepage or `HomeRoute.HomeLocation`
   (e.g. `/services`).
5. Prices and dates come from content fields as stored (Latin digits);
   controller-computed statistics use Persian digits. If full Persian digit
   rendering is wanted for stored values, a display driver or the
   `Vazirmatn FD` font variant can be adopted later.

Do not start Phase 5 (checkout/payment, Nextcloud/Drive, production rollout)
from this commit; architectural review and approval are required first.
