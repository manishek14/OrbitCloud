# PHASE6_DESIGN_SYSTEM (draft — U2 foundation, 2026-11-10)

**Status:** Drafted from source inspection and brief; **not visually verified** in browser (no browser toolchain available).

## Brand tokens (target)
- Deep Navy `#101A30`, Electric Blue `#1769FF`, Light Blue `#EAF2FF`, Surface `#FFFFFF`, Background `#F5F7FB`, Text `#182338`.
- Semantic: success/warning/danger/info with accessible contrast (WCAG 2.2 AA target).
- Typography: Persian-first/RTL-first, Vazirmatn (local `AbrITPortalTheme/wwwroot/fonts`), consistent scale/line-height, correct mixed FA/EN and currency/number alignment.
- Spacing/radius/elevation/borders/icon sizes/breakpoints (360,390,768,1024,1440,1920)/transitions/focus states to be unified.

## Existing foundation (repo)
- `AbrITPortalTheme/wwwroot/css/abrit-portal.css`: partial CSS variables (`--navy`, `--blue`, etc.), RTL base, header/nav/cards/forms/tables/dashboard primitives, responsive rules (partial).
- Layout: `Views/Layout.liquid`, login overrides, inline controller shells (to be replaced with view-based shells).

## Component inventory (required)
Buttons, icon buttons, inputs, password inputs, selects, sliders (pricing), checkboxes/radios, form groups, validation, alerts, toasts, modals, confirmations, tabs, breadcrumbs, badges, tables, pagination, filters, search, KPI/service/pricing cards, empty states, skeletons, error/loading states, tooltips, responsive nav/drawer.

## Implementation notes
- Keep customer and admin layouts independent but token-consistent.
- No new SPA framework; prefer Orchard Razor/Liquid/shapes + scoped CSS, minimal JS for real interactions (e.g. pricing slider preview calling server/M2 logic).
- Refactor inline HTML in `PortalController`/`MobileIdentityController` into maintainable views/partials.
- Admin: create `AbrITAdminTheme` based on TheAdmin (supported OC 3.0.1 mechanism) without modifying upstream packages; scoped overrides only.

## Gaps to complete
Full token file/sections, component CSS/partials, accessible slider with synced numeric input, pricing card system (5 plans, P3 featured), app shells (sidebar/topbar/mobile drawer), native Orchard auth page restyling coverage, admin theme foundation and ops dashboard components.
