# Task 2-a — Public site views + Auth views

**Agent:** Task 2-a (public + auth views)
**Scope:** 9 view files only. No shared file, layout, hook, or API route was modified.
**Status:** Complete — all views implemented, lint-clean, verified end-to-end in a real browser.

## Files written (all 9)

| File | Notes |
| --- | --- |
| `src/views/public/services-view.tsx` | Hero band + `usePublicContent("service")` grid (4 rotating lucide icons, hover lift), skeleton/error/empty states, bottom CTA → plans. |
| `src/views/public/plans-view.tsx` | `useCommerceCatalog()` only (no hardcoded prices). 5 PriceCards (guest → login with `next`), full comparison table (13 rows × 5 packages, sticky feature column, featured column `bg-primary/5`, `overflow-x-auto` + min-w for mobile), 3 contract policy cards + 6 policy note rows from `catalog.policy`. |
| `src/views/public/about-view.tsx` | `usePublicContent("page","about")` with hero-lite band, `whitespace-pre-wrap leading-8` body, 4 value cards, honest empty state for unpublished page, CTA → contact. |
| `src/views/public/contact-view.tsx` | Form (name/email/mobile/subject/message) with Persian client validation (message ≥ 10 chars to match server) → `useContactForm` → success panel swap + reset. Sidebar from `usePublicSettings()` (Phone/Smartphone/Mail/MapPin/Clock rows, ltr-iso values) + portal-tickets card. |
| `src/views/public/faq-view.tsx` | `usePublicContent("faq")` + SearchInput (client filter on title+body, Persian-digit-normalized), Accordion (home-view style), count badge «X سوال», no-result empty state, CTA row (contact + login). |
| `src/views/auth/register-view.tsx` | Two-step flow with AnimatePresence slide + stepper. Step 1: full client validation (name/email/mobile-normalized/password letter+digit/confirm/terms checkbox). Step 2: OTPInput + shake on code errors, 120s resend countdown, demo banner from display-delivery code, `useRegister` error mapping (code errors → shake; EMAIL_TAKEN/MOBILE_TAKEN → back to step 1). |
| `src/views/auth/verify-otp-view.tsx` | Reads `router.query.mobile`/`next`; redirects to login without mobile. Masked mobile subtitle (۰۹۱۲***۱۱۱۱), lazy sessionStorage demo-code read (mount-only, <5 min), auto-verify on OTP complete, resend resets countdown + updates banner, "تغییر شماره" → login. |
| `src/views/auth/forgot-password-view.tsx` | Email → `useRecoverRequest` → success panel (CheckCircle + API message + amber demo code banner with copy + button to `reset-password?email=…`). |
| `src/views/auth/reset-password-view.tsx` | Email prefilled from query, 6-digit code field (inputMode numeric, toEnDigits), new password + confirm with client validation, server error mapping (INVALID_CODE/CODE_EXPIRED/TOO_MANY_ATTEMPTS → code field inline, WEAK_PASSWORD → password field inline, all via toast), success panel + button → login. |

## Conventions followed

- `"use client"` + exact stub default export names preserved.
- Semantic Tailwind tokens only (bg-card, bg-muted/40, text-muted-foreground, bg-primary/10, text-warning, text-success, border-destructive…) — no hex.
- `toFaDigits`/`formatToman`/`formatBytes` for all numbers; emails/codes/phones in `<span className="ltr-iso" dir="ltr">`.
- Skeletons (SkeletonCards / ui/skeleton / pulse rows) for loading; `ErrorState` with retry; `EmptyState` for empty; `Loader2` spinners + disabled on all pending buttons; `toast` + `errorMessage` for errors.
- `Reveal`/`Stagger`/`StaggerItem` for section animations; no page-level `AnimatedContent` (layouts own it).
- All 9 views verified at 360px viewport — no horizontal overflow (comparison table uses `overflow-x-auto` + `min-w-[780px]` + mobile hint).

## Compile issues found & fixed

1. `contact-view.tsx` / `about-view.tsx` imported `Skeleton` from `@/components/abrit/ui` (doesn't export it — Turbopack 500). Fixed: import from `@/components/ui/skeleton`.
2. `react-hooks/set-state-in-effect` lint errors: reading sessionStorage into state inside mount effects. Fixed: verify-otp uses a lazy `useState` initializer (safe — auth views render only post-hydration in the hash-router); register captures the demo code from the OTP response at step-2 entry (same value it writes to sessionStorage) and the effect only resets the countdown.
3. Minor: stray `?` typo in faq-view template literal — fixed.

## Cross-file problems noticed but NOT fixed (shared files — lead's domain)

1. **`useRecoverReset` hook contract bug (important):** `src/app/api/auth/recover/reset/route.ts` requires a `confirm` field (`newPassword !== confirm` → 400), but `src/lib/api/hooks.ts` `useRecoverReset` only sends `{email, code, newPassword}` — every call through the hook fails with `VALIDATION "Invalid input: expected string, received undefined"`. **Workaround in my view:** reset-password-view uses a local `useMutation` + `api.post` that mirrors `newPassword` into `confirm` (commented in the file; sanctioned by the hooks-module header "add local mutations via api when needed"). Lead should either add `confirm` to the hook or drop it from the route schema; then the view can go back to the shared hook.
2. **`@/components/abrit/theme-switcher.tsx:29`** — lint error `react-hooks/set-state-in-effect` (shared component, not mine).
3. **Portal/admin views have 8 `react-hooks/set-state-in-effect` lint errors** (plan-detail-view, checkout-view, profile-view, settings-view, admin content-edit-view) — other agents' files.
4. **Dev server port 3000 was down for several minutes mid-task** (process vanished around 14:21, platform watchdog restarted it ~14:24; it also restarted once at 14:11). During the gap the Prisma client had also gone stale (schema was edited after server start — `db.contentItem` undefined etc.). After the watchdog restart everything works. If APIs ever 500 with `Cannot read properties of undefined (reading 'findMany')`, the dev server needs a restart to pick up the regenerated Prisma client.
5. **`prisma/seed.ts` `update: {}` for the about page:** the admin-side content testing flipped the `about` page to `draft` (public API returns `[]`, my view shows the correct empty state). Re-running the seed does NOT republish it (upsert with empty update). Demo would look better with it published — admin can republish from پنل مدیریت → محتوا.
6. Demo/test artifacts I created (harmless, in DB): users `test-task2a@abrit.ir` (09123334444) and `maryam.task2a@abrit.ir` (09125556666) from register-flow tests, plus a few guest contact tickets. Demo credentials were NOT changed (admin password reset to the same value `AbrIT@Admin1405`).

## Verification summary

- `curl http://localhost:3000/` → **200**; dev.log tail has no errors mentioning my files (last errors predate the Skeleton import fix).
- `bun run lint` → **0 problems in my 9 files** (remaining errors are in other agents'/shared files, listed above).
- Browser E2E (agent-browser, headless Chrome): services render (4 CMS cards), plans (5 cards + 6-column table + contract cards + policy notes), about (published body + value cards; draft → correct empty state), contact (full form submit → success panel; sidebar info), faq (search «فضای ابری» → 2/6 items; no-result empty state), register (step 1 → step 2 demo banner → OTP → session → #/portal), login-OTP → verify-otp (masked mobile, banner, countdown, auto-verify → #/portal), forgot-password → reset-password (email prefill, code, success panel + toast). No page errors; all views pass the 360px no-overflow check.
