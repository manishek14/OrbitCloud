# AbrIT CMS Cloud — Docker Deployment & Operations Guide

This guide deploys the complete stack with Docker Compose:

| Service | Image base | Port (host) | Purpose |
|---|---|---|---|
| `db` | `postgres:16-alpine` | internal only | `abrit_portal` (Prisma) + `abrit_orchard` (YesSql) |
| `portal` | built from `Dockerfile` (bun → node:22-slim) | `3000` | public site, portal, `/api/*`, reverse proxy to CMS |
| `cms` | built from `orchard/Dockerfile` (.NET 10) | `127.0.0.1:5001` (loopback debug only) | Orchard Core administration |

> Honesty note: the Docker artifacts were authored and syntax-validated in a
> sandbox **without a Docker daemon**. Build them on a machine with Docker
> 24+ / Compose v2 and report any deviation.

---

## 1. Prerequisites

- Docker 24+ with the Compose v2 plugin (`docker compose version`)
- 2 GB+ free RAM for the stack; ~4 GB disk for images
- For production: a public HTTPS origin with TLS termination (reverse proxy
  or cloud LB) in front of `portal:3000`

## 2. Configuration

```bash
cp .env.example .env
```

Mandatory values in `.env`:

| Variable | Why |
|---|---|
| `ABRIT_SERVICE_TOKEN` | Shared secret of the Orchard ⇄ portal contract. Generate: `openssl rand -hex 24`. Same value is wired into both containers automatically. |
| `POSTGRES_PASSWORD` | **Required — compose refuses to start without it** (there is deliberately no insecure default). Generate: `openssl rand -hex 24`. Local development: use `docker/compose.dev.yml` (below) which pins a clearly-isolated dev password. |
| `OTP_HMAC_SECRET` | **Required in production** — dedicated HMAC secret for OTP / recovery-code hashing (audit §3.5). Generate: `openssl rand -hex 32`. No implicit fallback exists (the former ABRIT_SERVICE_TOKEN fallback was removed by engineering review). Rotation: move the old value to `OTP_HMAC_SECRET_PREVIOUS`. |
| `SMSIR_API_KEY`, `SMSIR_TEMPLATE_ID` | Real SMS.ir Verify credentials. Without them keep `OTP_DELIVERY_MODE=display` — **isolated development only**, production must be `sms`. |
| `ABRIT_PAYMENTS_PUBLIC_BASE_URL` | **Required in production.** The public HTTPS origin used to build gateway callback URLs (never derived from Host headers). |
| `NEXTCLOUD_MODE=live` + `NEXTCLOUD_ADMIN_USER` / `NEXTCLOUD_ADMIN_APP_PASSWORD` | AbrIT Drive production integration. `simulation` deliberately refuses to run when `NODE_ENV=production`. `NEXTCLOUD_ALLOW_INSECURE` is ignored in production (HTTPS only). |

Portal/CMS host ports (optional overrides): `PORTAL_PORT` (default 3000),
`CMS_PORT` (default 5001). The CMS debug port is bound to **127.0.0.1 by
default** — administration belongs behind the public proxy at
`https://<your-domain>/admin`. `CMS_BIND` can override the bind address for
isolated development environments only.

### Local development (isolated dev password)

```bash
# base compose + the development override (pins POSTGRES_PASSWORD=abrit_dev_pw
# and exposes the CMS debug port on all interfaces for dev containers/VMs):
docker compose -f docker-compose.yml -f docker/compose.dev.yml up -d --build
```

## 3. First run

```bash
docker compose up -d --build
docker compose ps            # wait for healthy (db → portal, cms)
docker compose logs -f portal cms
```

What happens automatically:

1. **db** starts and (first start only) runs `docker/postgres-init.sql`,
   creating `abrit_orchard` next to `abrit_portal`.
2. **portal** entrypoint runs `prisma migrate deploy` (all migrations in
   `prisma/migrations`), optionally seeds when `SEED_ON_START=true`, then
   serves the standalone Next.js server on `0.0.0.0:3000`.
3. **cms** serves Orchard on `0.0.0.0:5000` (host-mapped to `127.0.0.1:5001`
   by default — loopback only).

### 3.1 Orchard first-run setup (secure, no default password)

1. Open `http://<your-domain>/admin` (proxied through the portal origin) or
   `http://127.0.0.1:5001/admin` from the Docker host for direct debugging
   (the debug port is loopback-bound by default).
2. Orchard shows its **setup screen**. The PostgreSQL connection is pre-filled
   from compose (`OrchardCore__Default__*`):

   ```
   Host=db;Port=5432;Database=abrit_orchard;Username=abrit;Password=<POSTGRES_PASSWORD>
   ```

   Confirm/adjust it, choose the recipe and create the **first administrator
   with a strong password** (≥ 12 chars). This is the normal, secure
   production flow — no default credentials are baked anywhere.

### 3.2 Operator bootstrap (only when the admin password must be re-set)

The codebase ships a guarded CLI (`--abrit-admin-bootstrap`). In the compose
stack it requires the explicit opt-in:

```bash
ABRIT_ADMIN_BOOTSTRAP_ENABLED=true \
ABRIT_ORCHARD_ADMIN_USERNAME=abrit-admin \
ABRIT_ORCHARD_ADMIN_EMAIL=admin@abrit.ir \
ABRIT_ORCHARD_ADMIN_PASSWORD='Min12Chars-Strong-Passphrase' \
docker compose exec cms dotnet AbrITPortal.dll --abrit-admin-bootstrap
```

## 4. Service-to-service contract

The CMS reads canonical commerce records (customers, orders, payments,
subscriptions, tickets) from the portal through `/api/admin/*`, authenticated
with `ABRIT_SERVICE_TOKEN`:

- portal: `ABRIT_SERVICE_TOKEN` env (Prisma side owns the data)
- cms: `AbrIT__CommerceApi__ServiceToken` + `AbrIT__CommerceApi__BaseUrl`
  (already wired to `http://portal:3000` in compose)

`appsettings.json` ships an EMPTY `ServiceToken` default — real values only
ever travel via environment variables / the compose wiring / secret managers.
(For bare-metal runs, `orchard-watchdog.sh` sources the project `.env` and
exports the same variable.)

Rotate the token by changing `.env` and running `docker compose up -d` — both
containers receive the new value.

## 5. Upgrades & migrations

### CMS filesystem migration for existing deployments

The CMS image now runs the application as UID/GID 10001 and keeps three named
volumes: `cms_appdata` (existing tenant data), `cms_imagesharp_cache`, and
`cms_data_protection_keys`. The startup script updates ownership where needed
inside these volumes; it does not replace tenant files. PostgreSQL and its
`pgdata` volume are unchanged. The image includes `/app/wwwroot`, and ImageSharp
uses `/var/lib/abrit-portal/imagesharp-cache` rather than the web root.

Before replacing an older CMS container, copy any files from its
`/root/.aspnet/DataProtection-Keys` directory into the new
`abrit-cloud_cms_data_protection_keys` volume. Keep the key XML files private:
existing authentication cookies and protected payloads may depend on them.
For a new deployment there are no old keys to migrate. Verify that `.env`
contains the current `ABRIT_SERVICE_TOKEN` and the password of the existing
PostgreSQL role as `POSTGRES_PASSWORD` before running Compose; changing only the
container environment does not reset the database role password.

After deployment, check `docker compose ps`, `docker compose logs cms`, and a
CMS page such as `/admin`. The CMS healthcheck uses `/admin` because a tenant
may legitimately have no page at `/`.

```bash
git pull
docker compose build
docker compose up -d           # portal entrypoint re-runs `prisma migrate deploy`
```

Schema changes must ship as new Prisma migrations
(`bunx prisma migrate dev --name <change>` on a dev machine) — the container
never mutates the schema outside `migrate deploy`.

## 6. Backups

```bash
# both logical databases in one dump
docker compose exec db pg_dump -U abrit -d abrit_portal  > backup_portal.sql
docker compose exec db pg_dump -U abrit -d abrit_orchard > backup_orchard.sql

# CMS media + tenant files
docker run --rm --volumes-from abrit-cms -v "$PWD":/backup alpine \
    tar czf /backup/cms_appdata.tgz /app/App_Data
```

## 7. Production checklist

- [ ] TLS terminates in front of `portal`; `ABRIT_PAYMENTS_PUBLIC_BASE_URL`
      set to that public origin.
- [ ] `OTP_DELIVERY_MODE=sms` with real SMS.ir credentials (never `display`).
- [ ] `NEXTCLOUD_MODE=live` with real Drive admin app-password (HTTPS base URL;
      `NEXTCLOUD_ALLOW_INSECURE` is ignored in production).
- [ ] `POSTGRES_PASSWORD` set to a strong generated value (no default exists).
- [ ] `OTP_HMAC_SECRET` set to a strong generated value — **mandatory**;
      production refuses to issue OTP/recovery codes without it.
- [ ] `ABRIT_SERVICE_TOKEN` regenerated (`openssl rand -hex 24`).
- [ ] `CMS_BIND` left at the `127.0.0.1` default — administration belongs
      behind the portal origin; never expose the debug port publicly.
- [ ] First Orchard administrator created through the secure setup screen;
      `ABRIT_ADMIN_BOOTSTRAP_ENABLED` left `false`.
- [ ] Payment gateways verified in the provider sandboxes with merchant
      credentials before any live enablement.

## 8. Retention & cleanup of short-lived security records

Documented policy (implemented by the admin-only endpoint
`POST /api/admin/maintenance/cleanup` — supports `{"dryRun":true}`):

| Record | Retention |
|---|---|
| `OtpGrant` (login/register/recover codes) | purged 24 h after creation (max TTL is 10 min) |
| `RecoveryGrant` (email recovery codes) | purged 24 h after creation |
| `Session` (expired sessions) | purged 7 days after expiry |
| `LoginAttempt` (throttle counters) | purged after 30 days (throttle window is 15 min) |
| `SmsOutbox` (delivery audit) | purged after 90 days |

Run it on a schedule (e.g. weekly) with an admin session or service token:

```bash
curl -X POST https://<your-domain>/api/admin/maintenance/cleanup \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $ABRIT_SERVICE_TOKEN" -d '{}'
```

The audit log itself is NOT purged by this endpoint — retain it according to
your compliance requirements.

## 9. Troubleshooting

| Symptom | Check |
|---|---|
| Portal unhealthy | `docker compose logs portal` — Prisma migration output, then `/api/health` payload (`db: up/down`, `integrations.sms`, `integrations.drive`). |
| `/admin` shows Next 404 | `ORCHARD_PROXY_TARGET` must be `http://cms:5000` (compose default) and `cms` must be healthy. |
| CMS 500 on start | `docker compose logs cms`; confirm `abrit_orchard` exists (`docker compose exec db psql -U abrit -l`). |
| Commerce API 401 in CMS logs | `ABRIT_SERVICE_TOKEN` differs between the two containers — re-run `docker compose up -d` after editing `.env`. |
| OTP never arrives | `OTP_DELIVERY_MODE` must be `sms` in production and `SMSIR_API_KEY`/`SMSIR_TEMPLATE_ID` must be real; check portal logs for the SMS.ir response. |
