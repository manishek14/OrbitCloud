# AbrIT CMS Cloud

AbrIT Orchard Core Client Portal — production-ready stack combining:

- **AbrIT Portal** (Next.js 16): public site, customer portal, authentication
  (SMS.ir OTP), commerce (plans/quotes/orders), ZarinPal & Zibal sandbox
  payments, support tickets, AbrIT Drive client.
- **AbrIT CMS** (Orchard Core 3.x, .NET 10): the **real** administration CMS
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
| `orchard/` | Orchard Core solution — `AbrITPortal` host + `AbrITAdminTheme` / `AbrITPortalTheme` |
| `prisma/` | Prisma schema + PostgreSQL migrations |
| `docker/` | Compose support files (entrypoint, DB bootstrap) |
| `Dockerfile` | Portal image (bun build → standalone Node runtime) |
| `orchard/Dockerfile` | CMS image (.NET 10 SDK build → ASP.NET runtime) |
| `docker-compose.yml` | Full stack: db + portal + cms |
| `docs/` | Architecture, audit & fix reports, deployment guide, evidence |

## Quick start (Docker)

```bash
cp .env.example .env
# set at minimum: ABRIT_SERVICE_TOKEN (openssl rand -hex 24)
docker compose up -d --build
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
- [`docs/FIX_REPORT_2026-11-13.md`](docs/FIX_REPORT_2026-11-13.md) — critical
  fix round (auth routing, validation, payments atomicity, Orchard branded
  login, OTP policy) with browser evidence
- [`docs/AUDIT_REPORT.md`](docs/AUDIT_REPORT.md) — source-level audit
- [`docs/ABRIT_DRIVE_INTEGRATION.md`](docs/ABRIT_DRIVE_INTEGRATION.md) —
  Nextcloud/AbrIT Drive integration contract

## Security notes

- Real secrets live **only** in `.env` (git-ignored). `.env.example` ships
  placeholders only.
- The service-to-service token (`ABRIT_SERVICE_TOKEN`) authenticates the
  Orchard ⇄ portal contract and must be rotated per deployment.
- Payment gateways run in **sandbox** mode; production requires the
  documented merchant credentials and `ABRIT_PAYMENTS_PUBLIC_BASE_URL`.
