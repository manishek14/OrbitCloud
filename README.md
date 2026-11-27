# Orbit CMS Cloud

Orbit Orchard Core Client Portal — production-ready stack combining:

- **Orbit Portal** (Next.js 16): public site, customer portal, authentication
  (SMS.ir OTP), commerce (plans/quotes/orders), ZarinPal & Zibal sandbox
  payments, support tickets, Orbit Drive client.
- **Orbit CMS** (Orchard Core 3.x, .NET 10): the **real** administration CMS
  at `/admin` — content management, customers, orders, admin themes. It is a
  separate application, proxied behind the same origin by the portal.
- **PostgreSQL 16**: two logical databases — `abrit_portal` (Prisma, canonical
  commerce records) and `abrit_orchard` (YesSql CMS documents).

> معماری: پورتال Next.js در 3000 و CMS واقعی Orchard Core در پس‌زمینه؛
> همه‌ی مسیرهای مدیریتی (`/admin`, `/Login`, …) از طریق همان دامنه به Orchard
> پروکسی می‌شوند. راهنمای استقرار: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## Repository layout

| Path | Purpose |
|---|---|
| `src/` | Next.js portal (app router, API routes, views, libs) |
| `orchard/` | Orchard Core solution — `AbrITPortal` host + `AbrITAdminTheme` / `AbrITPortalTheme` + test harnesses |
| `prisma/` | Prisma schema + PostgreSQL migrations |
| `docker/` | Compose support files (entrypoint, DB bootstrap, dev override) |
| `Dockerfile` | Portal image (bun build → standalone Node runtime, non-root) |
| `orchard/Dockerfile` | CMS image (.NET 10 SDK build → ASP.NET runtime, non-root) |
| `docker-compose.yml` | Full stack: db + portal + cms (requires `POSTGRES_PASSWORD`) |
| `docker/compose.dev.yml` | Local-dev override (isolated dev DB password, CMS debug port) |
| `.github/workflows/ci.yml` | CI: lint, types, tests, Next.js build, .NET build + harnesses, Docker builds |
| `docs/` | Architecture, audit & fix reports, deployment guide, evidence |

## Quick start (Docker)

```bash
cp .env.example .env
# REQUIRED: POSTGRES_PASSWORD and ABRIT_SERVICE_TOKEN (openssl rand -hex 24)
docker compose up -d --build

# Local development (isolated dev DB password + CMS debug port):
# docker compose -f docker-compose.yml -f docker/compose.dev.yml up -d --build
```

Then:

- Portal: `http://localhost:3000`
- CMS administration (first run → Orchard setup screen): `http://localhost:3000/admin`
- Health: `http://localhost:3000/api/health`

Full guide incl. admin bootstrap, backups and the production checklist:
**[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)**

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Docker deployment & operations
- [`docs/ORBITCLOUD_COMPREHENSIVE_AUDIT_REPORT.md`](docs/ORBITCLOUD_COMPREHENSIVE_AUDIT_REPORT.md) —
  2026-11 comprehensive security & engineering audit (this round)
- [`docs/FIX_REPORT_2026-11-13.md`](docs/FIX_REPORT_2026-11-13.md) — critical
  fix round (auth routing, validation, payments atomicity, Orchard branded
  login, OTP policy) with browser evidence
- [`docs/AUDIT_REPORT.md`](docs/AUDIT_REPORT.md) — source-level audit
- [`docs/ORBIT_DRIVE_INTEGRATION.md`](docs/ORBIT_DRIVE_INTEGRATION.md) —
  Nextcloud/Orbit Drive integration contract
- [`docs/ORBITCLOUD_REBRAND_REVIEW_2026-11-27.md`](docs/ORBITCLOUD_REBRAND_REVIEW_2026-11-27.md) —
  2026-11-27 independent review + AbrIT → Orbit rebrand record
- [`docs/ORCHARD_HOSTING_GUIDE.md`](docs/ORCHARD_HOSTING_GUIDE.md) — hosting
  the Orchard CMS without a dedicated server (Fly.io walkthrough)

## Development & testing

```bash
bun install --frozen-lockfile
bunx prisma generate
bun run lint          # ESLint
bunx tsc --noEmit     # TypeScript
bun test              # unit/integration tests (external services mocked)
bun run build:docker  # production standalone build
```

The .NET test harnesses require the .NET 10 SDK:

```bash
dotnet build orchard/AbrITPortal.slnx -c Release
dotnet run --project orchard/AbrITPortal.SecurityTests -c Release --no-build
dotnet build orchard/AbrITPortal/AbrITPortal.csproj -c Debug
dotnet run --project orchard/AbrITPortal.PricingTests -c Debug --no-build
```

All of the above run automatically in CI on every push
(`.github/workflows/ci.yml`).

## Security notes

- Real secrets live **only** in `.env` (git-ignored). `.env.example` ships
  placeholders only.
- The service-to-service token (`ABRIT_SERVICE_TOKEN`) authenticates the
  Orchard ⇄ portal contract and must be rotated per deployment.
- OTP and password-recovery codes are stored as **keyed HMACs**
  (`OTP_HMAC_SECRET`) — a database leak alone cannot reveal usable codes.
- Password-login throttling uses dedicated, indexed per-identifier and per-IP
  counters; raw identifiers never appear in throttle storage or audit logs.
- Payment gateways run in **sandbox** mode; production requires the
  documented merchant credentials and `ABRIT_PAYMENTS_PUBLIC_BASE_URL`.
- Both containers run as non-root users; the CMS debug port is loopback-bound
  by default.
