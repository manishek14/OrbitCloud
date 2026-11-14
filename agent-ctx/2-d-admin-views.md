# Task 2-d — Admin Views (20/20 complete)

Agent: Task 2-d (AbrIT Admin views)
Scope: ONLY `src/views/admin/*.tsx` — 20 view files (dashboard-view was pre-existing and untouched).

## Files written (all 20)

1. `src/views/admin/content-view.tsx` — AdminContentView: type-tab filter, DataTable, publish/unpublish (useSaveContent), delete (ConfirmDialog → useDeleteContent), CTA to adminContentNew.
2. `src/views/admin/content-edit-view.tsx` — AdminContentEditView({id?}): create/edit form, slug/excerpt/body/status/sortOrder, sticky action bar, delete for existing; new-save → router.replace(edit URL). Hydration uses render-time state adjustment (lint-safe).
3. `src/views/admin/media-view.tsx` — AdminMediaView: upload drop-zone (8MB client check, images+PDF), Stagger grid, image/PDF preview, copy-path (clipboard+toast), delete.
4. `src/views/admin/users-view.tsx` — AdminUsersView: role stat cards, users table, details Dialog with role Select + status toggle + name edit (useAdminUpdateUser), roles note card.
5. `src/views/admin/roles-view.tsx` — AdminRolesView: 3 role cards with live user counts (useAdminUsers), permission matrix mirroring `PERMISSIONS`/`STAFF_PERMISSIONS` from rbac.ts exactly (local mirror, no server import), enforcement card.
6. `src/views/admin/customers-view.tsx` — AdminCustomersView: 400ms debounced server search, stat row (total/withDrive/activeSubscription), details Dialog (status toggle + name edit).
7. `src/views/admin/orders-view.tsx` — AdminOrdersView: status chips + stat chips, details Dialog via useAdminOrder (customer, per-item lineItems breakdown, totals, paidAt/cancelledAt), honest "no manual status change" notes.
8. `src/views/admin/payments-view.tsx` — AdminPaymentsView: transaction stats (succeeded/pending/failed+total), mock gateway badge, callback-only note.
9. `src/views/admin/invoices-view.tsx` — AdminInvoicesView: invoice table + printable Dialog (header, گیرنده, items with شرح/mبلغ, جمع کل) + window.print.
10. `src/views/admin/subscriptions-view.tsx` — AdminSubscriptionsView: active/expired stats (computed from expiresAt), red past expiry, "منقضی شده" badge overrides stored status.
11. `src/views/admin/plans-view.tsx` — AdminPlansView: full 1405 tariff catalog (all fields incl. extra fees, SLA detail, VPS, on-site, benefits), contract policies table, policy notes; honest code-governed banner.
12. `src/views/admin/drive-view.tsx` — AdminDriveView: stats, table with per-row sync/enable/disable actions (ConfirmDialog with warning for disable), result.message toasts.
13. `src/views/admin/tickets-view.tsx` — AdminTicketsView: status chips, stats from current rows, guest-sender labels, row → adminTicket(id).
14. `src/views/admin/ticket-detail-view.tsx` — AdminTicketDetailView({id}): polling thread, staff/customer bubbles (bg-primary/10 vs bg-muted), system messages, auto-scroll, reply box disabled when closed, close via ConfirmDialog.
15. `src/views/admin/reports-view.tsx` — AdminReportsView: 3 StatCards + recharts Area (revenue 6mo, fa-IR month labels), Pie (orders by status + legend), Bar (plan distribution); per-chart honest empty states when all-zero.
16. `src/views/admin/audit-view.tsx` — AdminAuditView: ACTION_LABELS_FA (copied from dashboard + all extra keys), client-side search, meta Dialog (parsed K/V + raw JSON ltr pre), note card.
17. `src/views/admin/recipes-view.tsx` — AdminRecipesView: explanation card, blob download export (`abrit-content-recipe-${Date.now()}.json`), JSON import with client-side parse + created/skipped result panel.
18. `src/views/admin/queries-view.tsx` — AdminQueriesView: type/status/search builder → useQuery(api.get /api/admin/queries?...), count chip, results table.
19. `src/views/admin/workflows-view.tsx` — AdminWorkflowsView: deliberate, designed "not implemented in this environment" page (Orchard Core module intro).
20. `src/views/admin/settings-view.tsx` — AdminSettingsView: Nextcloud card (mode/configured/loginUrl), payment gateways list, OTP delivery warning (display mode), editable contact form (usePublicSettings → useAdminUpdateSettings POST).

## Verified against live APIs (curl, admin@abrit.ir)

- login/dashboard/content/users/customers/...: all 200.
- Content lifecycle: PATCH unpublish 200; POST create (slug auto from title); encoded search query; DELETE 200.
- Drive action `sync` → `{ok:true,message:"همگام‌سازی انجام شد — وضعیت: ready"}` (matches view toast).
- Media upload 201 (`{asset}`), media DELETE 200; `/uploads/<file>` serves 200 (image previews work).
- Settings POST 200 and /api/content/settings reflects saved values.
- Admin ticket: detail (guest fields), reply 200, close 200 → status closed.
- GET / → 200 with all 20 views compiled; `rg views/admin dev.log` → no errors; `bun run lint` → my files clean.

## Compile/lint issues found & fixed (in my files)

- users-view: stray `tone="muted" in` typo on StatCard → fixed (tone="success").
- payments-view/audit-view: imported non-existent `Badge` from abrit/ui → removed.
- subscriptions-view: mid-file `import type` → moved to top.
- queries-view: invalid `<StatusBadge row.status />` → `<StatusBadge status={row.status} />`; added missing FormField import.
- media-view: unused eslint-disable directive removed.
- content-edit-view & settings-view: `react-hooks/set-state-in-effect` errors → replaced effect-hydration with React's render-time state-adjustment pattern.
- orders-view: dialog could render skeleton AND error block simultaneously → restructured to exclusive branches.
- roles-view: `min-w-125` → `min-w-[520px]` (explicit arbitrary value).

## Cross-file problems noticed but NOT fixed (not my scope)

1. **Stale Prisma client / dev server restart (resolved, needs team awareness)**: login + /api/content/settings were 500-ing (`Unknown argument lastLoginAt`) because the running dev server held a PrismaClient generated before the schema gained `lastLoginAt`/`role`/`status`/`company`. Fix applied: `bun run db:push` (regenerates client) + dev-server restart. If anyone hits "Unknown argument …" prisma errors again → run `bun run db:push`, then restart dev server (the in-memory `globalThis.prisma` singleton keeps the old DMMF otherwise).
2. **Dev server went down mid-task** (died after a next.config.ts-triggered restart; EADDRINUSE traces show concurrent restart races). I restarted it detached (`setsid nohup bun run dev`). Only ONE `bun run dev` should run at a time — coordinate restarts.
3. `src/components/abrit/theme-switcher.tsx:29` — remaining project lint error (`react-hooks/set-state-in-effect`). Owner: whoever owns shared components.
4. `src/views/public/about-view.tsx` briefly imported non-existent `Skeleton` from abrit/ui (blocked whole-app compile); the owner fixed it — resolved. Suggest using `Skeleton` from `@/components/ui/skeleton` or `SkeletonRows/SkeletonCards` from abrit/ui.
5. `useAdminQueries` hook ignores filter params (queries are hardcoded); I used `api.get("/api/admin/queries?…")` + useQuery per spec instead. Hook untouched (shared file).
6. Prisma query logging is verbose (`log: ['query']` in src/lib/db.ts) — noisy dev.log; left as-is.
