# Task 2-b — Portal Views (9 files) Work Record

Agent: Task 2-b (customer-portal views)
Scope: ONLY these files (all under `src/views/portal/`):
services-view, service-detail-view, plans-view, plan-detail-view, drive-view,
notifications-view, profile-view, security-view, settings-view.

## Environment fix applied (IMPORTANT for other agents)

**Problem found:** All DB-backed API routes returned 500 (`Unknown argument lastLoginAt`,
`db.contentItem undefined`). Cause: the dev server (started 13:13) had a **stale Prisma
Client** cached in turbopack memory — the schema/client was regenerated later (db push +
seed at ~13:43 by task 1), but turbopack does not re-read `node_modules` changes.

**Fix applied (no dev-server restart command needed):**
1. Ran `bun run db:push` (regenerates Prisma client on disk).
2. Temporarily edited `src/lib/db.ts` to bust the HMR global prisma singleton
   (`globalForPrisma.prisma = undefined` before re-assignment) — **reverted afterwards**.
3. Appended a harmless comment to `next.config.ts` → Next 16 auto-restarts the dev
   server on config change ("Found a change in next.config.ts"). This made the running
   server reload everything, including the fresh Prisma client.

**Result:** All APIs work now (login, /api/me, /api/services, /api/drive/*, catalog,
quote, sessions, notifications all 200). Verified with curl.

Note for other agents: if you regenerated the prisma client and APIs still fail with
stale-schema errors, trigger the config-change restart (touch next.config.ts with a real
content change) — do NOT kill the server manually.

## Verified live API shapes (demo@abrit.ir / AbrIT@Demo1405)

- `/api/me`: user + role + unreadNotifications + entitledPlanCode (null for demo).
- `/api/drive/status`: mode "simulation", state "not_provisioned",
  loginUrl "/login?XTransformPort=3031" (relative → mock service on 3031).
- `/api/commerce/catalog`: 5 packages (essential..enterprise), contracts 3/6/12 months
  (3%/5%/8% discount; onboarding 50%/25%/free), limits {40 users, 60 endpoints},
  policy strings (prepaid, customAssessment, slaNote...).
- `/api/commerce/quote`: lineItems with signed amountToman (discount negative),
  breakdown, snapshot.quoteId, checkoutEnabled.
- Drive error codes via `ApiRequestError.code`: INVALID_USERNAME, INVALID_PASSWORD,
  USERNAME_TAKEN (409), ALREADY_LINKED (409), PLAN_NOT_FOUND.
- Password change error codes: BAD_CREDENTIALS (401), WEAK_PASSWORD (400).
- Drive plan codes: "trial" (100MB, quota 100*1024*1024 local display) + the 5
  commercial codes with driveQuotaBytes from catalog.

## Progress

- [x] Context reading (types, hooks, ui kit, router, exemplars, live APIs)
- [ ] 9 view files (see final report)

Details in final report at the end of this file.
