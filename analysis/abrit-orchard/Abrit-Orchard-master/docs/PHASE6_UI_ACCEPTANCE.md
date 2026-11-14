# PHASE6_UI_ACCEPTANCE (U1 scaffold — 2026-11-10)

**Legend:** Complete and visually verified | Implemented but not visually verified | Blocked by backend | Incomplete  
**Visual verification status:** **Not performed** — browser/runtime capture tooling unavailable (Edge/Playwright/Node not installed). All rows below are source-inspected estimates pending rendered evidence in `docs/ui-review/phase6/`.

| Route | Page purpose | Data source | Access | Implemented components (source) | Functional state | RTL | Responsive | A11y | Screenshot | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| `/portal` | Redirect to dashboard | N/A | Auth | Controller redirect | OK (source) | n/a | n/a | n/a | pending | Implemented but not visually verified |
| `/services` | Catalog / pricing | `AllServices`, (M2 engine not wired) | Public | Inline cards/list, disabled CTA | Partial; missing 5-plan comparison/slider/contract/breakdown | Partial | Partial | Unverified | pending | Incomplete |
| `/services/{id}` | Service detail | `AllServices` item | Public | Inline detail, disabled CTA | Partial | Partial | Partial | Unverified | pending | Incomplete |
| `/dashboard` | Customer dashboard | `MyOrders`, `UserManager` | Auth | Inline layout/sidebar/KPIs/table/Drive placeholder | Partial; metrics limited to orders, no real paid/provisioning/renewal | Partial | Partial | Unverified | pending | Incomplete |
| `/account` | Account profile | `UserManager`/Orchard user | Auth | Inline profile + links | Partial | Partial | Partial | Unverified | pending | Incomplete |
| `/Login` | Native login | Orchard Users | Public | Theme Razor overrides | Partial; verify full Persian/native states | Partial | Unverified | Unverified | pending | Implemented but not visually verified |
| `/customer/register` | Registration | `MobileIdentityService`, SMS/OTP | Public | Inline form/OTP flow | Backend partial (mock SMS), UI inline/non-premium | Partial | Unverified | Unverified | pending | Incomplete |
| `/customer/register/verify` | OTP verify | `MobileIdentityService` | Public | Inline | Partial | Partial | Unverified | Unverified | pending | Incomplete |
| `/customer/mobile` | Change mobile | `MobileIdentityService` | Auth | Inline | Partial | Partial | Unverified | Unverified | pending | Incomplete |
| `/customer/mobile/verify` | Verify mobile | `MobileIdentityService` | Auth | Inline | Partial | Partial | Unverified | Unverified | pending | Incomplete |
| `/customer/recover` | Mobile recovery start | `MobileIdentityService` | Public | Inline | Partial | Partial | Unverified | Unverified | pending | Incomplete |
| `/customer/recover/verify` | Recovery OTP | `MobileIdentityService` | Public | Inline | Partial | Partial | Unverified | Unverified | pending | Incomplete |
| `/customer/recover/reset` | Reset password | `MobileIdentityService` | Public | Inline | Partial | Partial | Unverified | Unverified | pending | Incomplete |
| `/ChangePassword` | Native change password | Orchard Users | Auth | Native | Unknown theme coverage | Unverified | Unverified | Unverified | pending | Implemented but not visually verified |
| `/ChangeEmail` | Native change email | Orchard Users | Auth | Native | Unknown theme coverage | Unverified | Unverified | Unverified | pending | Implemented but not visually verified |
| `/ForgotPassword` `/ResetPassword` | Native email recovery | Orchard Users | Public | Native | Unknown theme coverage; SMTP config-dependent | Unverified | Unverified | Unverified | pending | Blocked by backend / unverified |
| `/Admin/AbrIT/Commercial/Plans` | Commercial plan management | `ICommercialRulesService`, M2 engine | Admin | Razor table/forms/preview | Functional (source) | Partial | Unverified | Unverified | pending | Implemented but not visually verified |
| `/Admin/AbrIT/Payments` | Payment ops | `IPaymentStore`, registry | Admin | Razor table/actions | Functional basic (mock/in-memory) | Partial | Unverified | Unverified | pending | Implemented but not visually verified |
| `/Admin/AbrIT/Sms` | SMS/queue ops | `ISmsOutboxStore`, providers | Admin | Razor table/actions | Functional basic | Partial | Unverified | Unverified | pending | Implemented but not visually verified |
| `/Admin/AbrIT/Jobs` | Background jobs list | Static/task metadata | Admin | Razor table | Basic | Partial | Unverified | Unverified | pending | Implemented but not visually verified |
| `/Admin` | AbrIT operational dashboard | `IAdminDashboardDataProvider` | Admin ops permission | AbrITAdminTheme over TheAdmin | Live customer/order/payment/SMS aggregates, recent orders, explicit unavailable states | RTL | Responsive source styles | Keyboard focus styles | pending | Implemented but not visually verified |
| `/Admin/*` (native) | CMS/Users/Roles/Settings/Content/Queries/Lucene/Features/Media | Orchard | Admin perms | AbrITAdminTheme over TheAdmin | Native functional | RTL shell; Orchard routes retained | Responsive source styles | Native + custom focus styles | pending | Implemented but not visually verified |
| Customer orders list/detail/confirmation/fail states | Order management | M3/order+payment domain (incomplete) | Auth | Not implemented as dedicated UI | N/A | n/a | n/a | n/a | pending | Blocked by backend / Incomplete |
| My Services / provisioning states | Service management | Provisioning domain (incomplete) | Auth | Drive placeholder only | N/A | n/a | n/a | n/a | pending | Blocked by backend / Incomplete |
| `/Admin/AbrIT/*` operations pages | Ops platform | Mixed (partial) | Admin | AbrIT sidebar navigation; individual pages remain separately tracked above/in source | N/A | RTL shell | Responsive shell styles | Focus styles | pending | Sidebar/dashboard implemented; page-by-page visual verification remains incomplete |

*To be expanded with per-state rows (empty/error/loading/OTP expiry/resend, slider bounds, mobile drawer, etc.) once implemented and rendered.*
