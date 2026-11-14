# PHASE6_UI_TEST_REPORT (U1 — 2026-11-10)

## Build & automated tests (actual)
| Command | Result |
|---|---|
| `dotnet build AbrITPortal.slnx --artifacts-path artifacts/build` | **PASS** (last recorded run in this track context: 0 errors, 56-57 warnings — pre-existing transitive NU1902/NU1903 advisories repeated per project/pass; no dependency upgrades). Re-run required after further UI changes. |
| `dotnet run --project AbrITPortal.SecurityTests/AbrITPortal.SecurityTests.csproj --artifacts-path artifacts/build` | **PASS** — `Assertions: 178; failures: 0` (43 prior security/order-isolation + M2 pricing; verified earlier in session). Re-run required after UI/backend-touching changes. |

## Browser / rendered acceptance (required by Phase 6)
- **Status:** **Not executed (blocked).**
- **Blocker:** no browser automation or headless capture tooling available in environment (`msedge`, `playwright`, `node`, `npx` not found). Isolated dev tenant runtime + route-by-route screenshots at 1920/1440/1024/768/390/360 for anonymous/customer/admin personas cannot be produced here.
- **Evidence:** `docs/ui-review/phase6/README.txt` (placeholder). No visual verification claimed.

## Functional workflow checks (runtime)
- Not executed against rendered app in this pass (depends on browser/manual interaction tooling and dev tenant launch). Source-level review indicates: login username/password preserved (OTP not required for ordinary login), OTP flows exist for registration/mobile verify/mobile recovery in custom controllers, pricing/order/payment/provisioning/Nextcloud backends incomplete for full end-to-end customer purchase/activation.

## Accessibility / responsive
- Not measured via browser tools (contrast, keyboard traversal, focus, overflow, touch targets, slider semantics). Source has partial RTL/responsive CSS; compliance not claimed.

## Issues observed (source audit)
- Inline HTML rendering in customer controllers; incomplete 5-plan pricing UI; missing dedicated AbrIT admin theme and many admin/customer pages/states; English/native-default risks on some Orchard flows; backend-dependent features must remain truthful (blocked/unavailable).

## Recommendation
Run on a machine with browser tooling (Playwright/Edge/Chromium + Node) against isolated dev tenant (`abrit_portal_dev_*`, `ORCHARD_APP_DATA` dev artifacts) to capture required screenshots and complete `PHASE6_UI_ACCEPTANCE.md` with route/state evidence.
