# AbrIT CMS Cloud — Docker Deployment & Operations Guide

This guide deploys the complete stack with Docker Compose:

| Service | Image base | Port (host) | Purpose |
|---|---|---|---|
| `db` | `postgres:16-alpine` | internal only | `abrit_portal` (Prisma) + `abrit_orchard` (YesSql) |
| `portal` | built from `Dockerfile` (bun → node:22-slim) | `127.0.0.1:3000` (loopback by default) | public site, portal, `/api/*`, reverse proxy to CMS |
| `cms` | built from `orchard/Dockerfile` (.NET 10) | `127.0.0.1:5001` (loopback debug only) | Orchard Core administration |

> Validation status (final-audit closure FSR-11): both compose renderings
> (`docker-compose.yml` alone and base + `docker/compose.dev.yml`) are
> validated with the REAL `docker compose config` CLI — locally with Docker
> Engine 27.5.1 / Compose v2.34.0 and on every CI run (see
> `docker/validate-compose.sh`). Since the compose-validation closure
> (FSR-13) every render is pinned to an EMPTY temporary env file, so a real
> `.env` on the validating machine can never influence what the validation
> observes. Both container images are really built in CI. A full
> `docker compose up` of the live stack was NOT exercised by the authoring
> environment (no Docker daemon there) — first boot happens on your machine;
> report any deviation.

---

## 1. Prerequisites

- **Docker Engine 24 or newer.** Compose orchestration is client-side, so any
  Engine that runs the images works; validation used Engine 27.5.1 and the
  GitHub Actions runner's preinstalled Engine. The Engine version alone
  proves NOTHING about the installed Compose version — see the next bullet.
- **Docker Compose v2.24.0 or newer — the binding requirement.** Check the
  version of the ACTUALLY installed plugin with `docker compose version`;
  never infer it from the Engine version: which Compose a host carries
  depends on the package, the distribution channel and when it was last
  updated, so an Engine 25+ host can still carry an older Compose plugin.
  (For reference only: the official Docker Engine 25.0.0 release notes
  record that that specific release's docker-ce packaging shipped Compose
  v2.24.1 — docker/docker-ce-packaging#980 — with 25.0.x patch releases
  later shipping 2.24.2/2.24.5/2.24.7. This is a statement about those
  releases' official packaging, NOT a guarantee for every Engine 25+
  install method or operating system; see
  https://docs.docker.com/engine/release-notes/25.0/.)
  This floor is REQUIRED, not cosmetic: `docker/compose.dev.yml` uses the
  `!override` YAML tag on the published ports, which Compose only supports
  since v2.24.0. Empirically verified: Compose v2.23.3 and v2.20.3 render
  the dev override WITHOUT an error but silently MERGE the port lists (both
  `0.0.0.0:3000` AND `127.0.0.1:3000`), which then fails at `up` time with
  "port is already allocated". The base `docker-compose.yml` alone renders
  identically on older Compose v2 releases (verified against
  v2.20.3/v2.23.3/v2.34.0), but v2.24+ everywhere is the supported
  configuration. If `docker compose version` reports anything older than
  v2.24.0, update the Compose plugin (for example
  `apt-get install --only-upgrade docker-compose-plugin`,
  `dnf update docker-compose-plugin`, or reinstall the plugin per
  docs.docker.com) or install the standalone Compose v2 binary before using
  the dev override.
- `jq` is only needed if you run `docker/validate-compose.sh` yourself.
- 2 GB+ free RAM for the stack; ~4 GB disk for images
- For production: a public HTTPS origin with TLS termination (reverse proxy
  or cloud LB) in front of `portal:3000`. The portal's published port binds
  to **127.0.0.1 by default** (`PORTAL_BIND`), so with the reverse proxy on
  the Docker host, public traffic can only arrive through it — direct
  network access to the portal cannot bypass the proxy-header trust
  contract (final-integration FSR-8). If your reverse proxy runs INSIDE the
  Docker network instead, remove the portal `ports` publishing (or scope it)
  and keep traffic on the private `abrit` network.
- The edge proxy MUST overwrite (not append) `x-real-ip` /
  `x-forwarded-for`, pin `Host`, and set `x-forwarded-proto` to the real
  scheme (`http`/`https`). It must also DELETE any inbound `x-real-ip` /
  `x-forwarded-for` / `x-forwarded-host` / `x-forwarded-proto` headers it
  cannot overwrite, so a client-injected value can never survive to the
  portal. When your edge guarantees this, set `ABRIT_TRUST_PROXY_HEADERS=true`
  and list your public host names in `ABRIT_TRUSTED_PUBLIC_HOSTS` (see §2).
  If the edge cannot guarantee this, leave both unset — the portal then
  refuses to trust client-supplied forwarding headers (final-remediation §3,
  unified in final-integration FSR-5).

### 1.1 Automated compose validation

The deployment contract is machine-checked by `docker/validate-compose.sh`
(run on every CI push as part of the docker job). It executes the REAL
`docker compose config` — no daemon needed — and asserts on the RENDERED
output:

- the base compose file and base + dev override both render without error,
- the portal container environment carries `ABRIT_TRUST_PROXY_HEADERS`,
  `ABRIT_TRUSTED_PUBLIC_HOSTS`, `ORCHARD_PROXY_TIMEOUT_MS` and
  `ABRIT_PROXY_MAX_BODY_BYTES` (with their documented defaults),
- operator values set in the shell / `.env` actually reach the rendered
  container environment,
- the production `PORTAL_BIND` default is `127.0.0.1` (loopback) and the dev
  override REPLACES it with `0.0.0.0` (exactly one port mapping — the
  `!override` mis-merge older Compose versions produce is detected),
- the database publishes no ports, portal and CMS publish only their
  documented loopback mappings,
- the CMS reaches the portal internally at `http://portal:3000`,
- the `abrit` network and the four named volumes exist in both renderings,
- the Compose version meets the v2.24.0 floor,
- every render is pinned to an EMPTY temporary env file (`--env-file`), so a
  real project `.env` on the validating machine can never change what the
  default-value checks observe (FSR-13) — and `--self-test` proves it with a
  sandboxed adversarial `.env` (control render without `--env-file` shows
  the leak, the isolated run shows the defaults).

Run it locally any time:

```bash
bash docker/validate-compose.sh
```

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
| `ABRIT_TRUSTED_PUBLIC_HOSTS` | **Recommended when a reverse proxy fronts the portal.** Comma/space-separated public host names (e.g. `portal.example.com, www.portal.example.com`). The ONLY way an inbound Host header is promoted to the CMS's public host (`Host` / `X-Forwarded-Host` upstream) — in EVERY trust mode (final-integration FSR-6). An inbound request carrying any other Host header cannot influence CMS-generated URLs or redirects; redirect Locations under these hosts are rewritten to safe relative paths. |
| `ABRIT_TRUST_PROXY_HEADERS` | Set to `true` **only** when an operator-controlled reverse proxy is in front of the portal AND that proxy pins `Host` and OVERWRITES `x-real-ip` / `x-forwarded-for` (the repo's Caddy gateway template does exactly this; so do standard Caddy/Nginx TLS edges). It switches the SHARED client-IP resolver (login/OTP/recovery throttles, session ipHash, contact/quote rate limits — final-integration FSR-5) to per-client keys. Resolution order (final-audit closure FSR-9): if an `x-real-ip` header EXISTS at all, its value is trimmed and accepted only as a bare valid IPv4/IPv6 literal — a PRESENT but empty, whitespace-only or otherwise invalid value fails closed to the single shared `unknown` bucket and NEVER falls through to `x-forwarded-for`; only when `x-real-ip` is genuinely ABSENT is `x-forwarded-for` consulted, using the RIGHTMOST valid member (never the spoofable first member). The CMS proxy additionally forwards `x-forwarded-for` and validates `x-forwarded-proto` (http/https only), `x-real-ip` (IP literal only) and `x-forwarded-port` (numeric only). The public Host STILL requires `ABRIT_TRUSTED_PUBLIC_HOSTS` — the flag alone never trusts the inbound Host. Leave `false` otherwise: Host is derived from configuration and all callers share one rate-limit bucket — spoofed client headers are ignored and limits stay active. |
| `NEXTCLOUD_MODE=live` + `NEXTCLOUD_ADMIN_USER` / `NEXTCLOUD_ADMIN_APP_PASSWORD` | AbrIT Drive production integration. `simulation` deliberately refuses to run when `NODE_ENV=production`. `NEXTCLOUD_ALLOW_INSECURE` is ignored in production (HTTPS only). |

Portal/CMS host ports (optional overrides): `PORTAL_PORT` (default 3000),
`CMS_PORT` (default 5001), `CMS_BIND` (default 127.0.0.1).

### PORTAL_BIND — production vs development

`PORTAL_BIND` controls the HOST interface the published portal port binds
to, and the two supported modes deliberately differ:

| Mode | Files | Default | Rendered publish | Why |
|---|---|---|---|---|
| **Production** | `docker-compose.yml` only | `127.0.0.1` | `127.0.0.1:3000 → 3000` | The documented topology runs the TLS-terminating reverse proxy ON THE DOCKER HOST; binding the portal to loopback means public traffic can only arrive through that proxy, so direct access can never bypass the proxy-header trust contract (final-integration FSR-8). |
| **Development** | base + `docker/compose.dev.yml` | `0.0.0.0` | `0.0.0.0:3000 → 3000` | Local dev containers / VMs / LAN colleagues reach `http://<host>:3000` directly; there is no production edge to bypass. |

The dev override uses the Compose `!override` tag so the dev binding
REPLACES the production one (exactly one port mapping) — this is why
Compose v2.24.0+ is required (see §1). Both defaults and the replacement
are asserted from the RENDERED compose output on every CI run by
`docker/validate-compose.sh` (§1.1). Only set `PORTAL_BIND=0.0.0.0` in
production after reviewing the network boundary: your reverse proxy must
then run inside Docker or you explicitly accept direct exposure. The CMS
debug port stays loopback-bound (`CMS_BIND`, default `127.0.0.1:5001`) —
administration belongs behind the public proxy at
`https://<your-domain>/admin`.

### How environment variables reach the containers

Compose interpolation is the ONLY path a variable from the project `.env`
(or your shell) reaches a container: it must be EXPLICITLY listed in the
service's `environment:` block with an interpolation reference. A value
that exists only in `.env` is silently ignored otherwise. The portal's
`environment:` block in `docker-compose.yml` lists every supported
variable explicitly, each with its documented safe default, e.g.

```yaml
environment:
  ABRIT_TRUST_PROXY_HEADERS: ${ABRIT_TRUST_PROXY_HEADERS:-false}
  ABRIT_TRUSTED_PUBLIC_HOSTS: ${ABRIT_TRUSTED_PUBLIC_HOSTS:-}
  ORCHARD_PROXY_TIMEOUT_MS: ${ORCHARD_PROXY_TIMEOUT_MS:-}
  ABRIT_PROXY_MAX_BODY_BYTES: ${ABRIT_PROXY_MAX_BODY_BYTES:-}
```

Three variables are REQUIRED (compose refuses to render without them):
`POSTGRES_PASSWORD`, `OTP_HMAC_SECRET` and `ABRIT_SERVICE_TOKEN`.
Set them in `.env` (never commit real values). The rendered result — what
the container actually sees — can always be inspected without a daemon:

```bash
# renders the fully merged model (does not print secrets unless you ask jq to)
docker compose -f docker-compose.yml config
```

The four proxy-contract variables above are verified to reach the rendered
portal environment (defaults AND operator overrides) by
`docker/validate-compose.sh` on every CI run.

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

## 5. The edge reverse proxy, trusted-proxy contract and the Caddyfile

Two DIFFERENT reverse proxies exist in this repository's world — do not
conflate them:

### 5.1 The repository Caddyfile — PREVIEW/SANDBOX ONLY

The `Caddyfile` at the repository root is the **development/sandbox preview
gateway**, NOT a production configuration:

- It listens on `127.0.0.1:81` only — it is never meant to be publicly
  reachable.
- It exists so the hosted preview environment can route `/?XTransformPort=`
  queries to enumerated local dev services (portal :3000, Nextcloud mock
  :3031; anything else is discarded to `127.0.0.1:9`).
- It DOES already implement the production edge contract (pin `Host`,
  overwrite `X-Forwarded-Proto` / `X-Real-IP`, REPLACE `X-Forwarded-For`),
  which makes it a correct REFERENCE for your own edge — but it is not
  itself a supported production edge. Production TLS termination, HTTP/2,
  certificates and public exposure belong to YOUR edge (Caddy, Nginx, a
  cloud LB, …) running on the Docker host (or inside Docker with the portal
  port unpublished).

### 5.2 The trusted-proxy contract (what your production edge MUST do)

The portal is deployed BEHIND your TLS edge. Two configuration switches
control how much the portal trusts forwarding headers, and both default to
the safe side:

1. **`ABRIT_TRUST_PROXY_HEADERS`** (default `false` — fail-closed): while
   `false`, NO forwarding header is trusted. Every caller keys to the single
   shared `unknown` rate-limit bucket, the CMS proxy derives its Host from
   configuration, and spoofed `x-real-ip` / `x-forwarded-for` / `Host`
   values are ignored. Limits stay ACTIVE — trusting nothing never disables
   rate limiting.
2. **`ABRIT_TRUSTED_PUBLIC_HOSTS`** (default empty): the ONLY way an
   inbound `Host` header is promoted to the CMS's public host, in EVERY
   trust mode (final-integration FSR-6). Any other Host cannot influence
   CMS-generated URLs or redirects.

Set `ABRIT_TRUST_PROXY_HEADERS=true` ONLY when your edge satisfies ALL of:

- `header_up Host {host}` / `proxy_set_header Host $host;` — pin the public
  Host (still subject to `ABRIT_TRUSTED_PUBLIC_HOSTS`).
- Overwrite `x-real-ip` with the REAL peer address — never forward a
  client-supplied value, and DELETE the header when unknown rather than
  sending it empty (a present-but-empty value fails closed in the portal —
  final-audit closure FSR-9 — costing you per-client buckets, so a correct
  edge sends either a valid IP literal or no header at all).
- REPLACE `x-forwarded-for` with the peer address — appending
  (`$proxy_add_x_forwarded_for`) is FORBIDDEN: the portal trusts only the
  RIGHTMOST XFF member, so an appending edge must not let a
  client-influenced member become the trusted one.
- Set `x-forwarded-proto` to the real scheme (`http`/`https`), overwriting
  any client value.
- Delete (or overwrite) every other `x-forwarded-*` header it does not set
  itself, so client-injected values can never survive to the portal.

Under trust, the shared client-IP resolver (login/OTP/recovery throttles,
session ipHash, contact/quote rate limits) keys on `x-real-ip` when the
header EXISTS — trimmed, and only as a bare valid IPv4/IPv6 literal; a
present but empty/whitespace/invalid value fails closed to the shared
`unknown` bucket with NO fallthrough to `x-forwarded-for` (FSR-9). Only
when `x-real-ip` is genuinely absent is `x-forwarded-for` consulted, via
its rightmost valid member.

### 5.3 Direct portal access restrictions

The portal's published port binds to `127.0.0.1` (production default), the
CMS debug port to `127.0.0.1:5001`, and the database publishes no ports at
all. Everything public must traverse your edge, which enforces TLS and the
header contract above. Inside the Docker network, container-to-container
traffic (CMS → `http://portal:3000`) is private and unaffected.

## 6. Upgrades & migrations

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

## 7. Backups

```bash
# both logical databases in one dump
docker compose exec db pg_dump -U abrit -d abrit_portal  > backup_portal.sql
docker compose exec db pg_dump -U abrit -d abrit_orchard > backup_orchard.sql

# CMS media + tenant files
docker run --rm --volumes-from abrit-cms -v "$PWD":/backup alpine \
    tar czf /backup/cms_appdata.tgz /app/App_Data
```

## 8. Production checklist

- [ ] `docker compose version` — the ACTUALLY installed plugin — reports
      **v2.24.0 or newer** (the dev override's `!override` tag floor; the
      Engine version alone does not prove this — see §1. Run
      `bash docker/validate-compose.sh` for the full machine-checked
      contract).
- [ ] TLS terminates in front of `portal`; `ABRIT_PAYMENTS_PUBLIC_BASE_URL`
      set to that public origin.
- [ ] `PORTAL_BIND` left at the `127.0.0.1` default — public traffic must
      arrive through the host's TLS reverse proxy; direct access to the
      portal port must not bypass the proxy-header trust contract
      (final-integration FSR-8). If the reverse proxy runs inside Docker,
      remove/scope the published portal port and keep traffic on the private
      `abrit` network.
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

## 9. Retention & cleanup of short-lived security records

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

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| Portal unhealthy | `docker compose logs portal` — Prisma migration output, then `/api/health` payload (`db: up/down`, `integrations.sms`, `integrations.drive`). |
| `/admin` shows Next 404 | `ORCHARD_PROXY_TARGET` must be `http://cms:5000` (compose default) and `cms` must be healthy. |
| CMS 500 on start | `docker compose logs cms`; confirm `abrit_orchard` exists (`docker compose exec db psql -U abrit -l`). |
| Commerce API 401 in CMS logs | `ABRIT_SERVICE_TOKEN` differs between the two containers — re-run `docker compose up -d` after editing `.env`. |
| OTP never arrives | `OTP_DELIVERY_MODE` must be `sms` in production and `SMSIR_API_KEY`/`SMSIR_TEMPLATE_ID` must be real; check portal logs for the SMS.ir response. |
