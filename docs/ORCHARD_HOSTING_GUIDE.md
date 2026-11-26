# Hosting the Orchard CMS without a dedicated server

The portal (Next.js) runs on Vercel. The CMS (Orchard Core 3.x, .NET 10) is a
**long-running container with state** (`/app/App_Data`, media files, YesSql) —
it cannot run on Vercel. Today `https://orbitcloud.vercel.app/admin` returns
502 because `ORCHARD_PROXY_TARGET` points at an unreachable host. This guide
stands the CMS up on free/cheap infrastructure with **no dedicated server**.

## Option comparison

| Option | .NET container | Media persistence | Cold starts | Cost/mo | Verdict |
|---|---|---|---|---|---|
| **Fly.io** | ✅ native Docker (`orchard/Dockerfile`) | ✅ Fly Volumes | none (always-on) or ~1s resume | ≈ $3–6 (shared-1x VM + 3GB volume) | **Recommended** |
| Railway | ✅ Docker deploy | ✅ volume plugin | none | ≈ $5 usage-based | Best alternative, simplest UX |
| Render | ✅ Docker | ✅ paid disk only | free tier spins down | ≈ $7 + disk | OK if paid |
| Google Cloud Run | ✅ | ❌ ephemeral FS (needs GCS FUSE) | 3–8s cold start | ~$0–5 | Needs code changes — avoid as-is |
| Koyeb | ✅ | ❌ | yes | ~$5 | Not suitable |

Postgres for the CMS (`abrit_orchard`): **Neon** (already used by the portal —
just add a second database) or Supabase. YesSql only needs a Npgsql connection
string with `SSL Mode=Require`.

## Fly.io walkthrough (≈ 20 minutes)

1. **Install + login**: `brew install flyctl && fly auth login`.
2. **Launch from the repo's CMS Dockerfile** (do NOT deploy yet):
   ```bash
   fly launch --dockerfile orchard/Dockerfile --name orbitcloud-cms --no-deploy
   ```
   Choose a region near your users; answer **no** to adding a database via Fly
   (we use Neon) and **no** to an internal Redis.
3. **Persistent volume** for Orchard media + `App_Data`:
   ```bash
   fly volumes create cms_appdata --size 3 --region <your-region>
   ```
   In `fly.toml` add:
   ```toml
   [mounts]
     source = "cms_appdata"
     destination = "/app/App_Data"
   ```
4. **Create the CMS database on Neon**: new project → copy the pooled
   connection string → run `CREATE DATABASE abrit_orchard;` (or create a
   dedicated Neon project for the CMS).
5. **Secrets** (match the portal's `ABRIT_SERVICE_TOKEN` value — the CMS calls
   the portal API with it):
   ```bash
   fly secrets set \
     AbrIT__CommerceApi__BaseUrl=https://orbitcloud.vercel.app \
     AbrIT__CommerceApi__ServiceToken=<same value as ABRIT_SERVICE_TOKEN> \
     ASPNETCORE_ENVIRONMENT=Production
   ```
6. **Deploy**: `fly deploy` then `fly status`. Note the public URL
   `https://orbitcloud-cms.fly.dev`.
7. **First run / Orchard setup**: open `https://orbitcloud-cms.fly.dev` once →
   the Orchard **setup screen** appears. Choose **PostgreSQL**, paste the Neon
   connection string for `abrit_orchard`, create the first admin (strong,
   unique password), finish setup. (You can also complete setup through
   `https://orbitcloud.vercel.app/admin` after step 8.)
8. **Wire the portal proxy** — in Vercel → Project → Settings → Environment
   Variables:
   - `ORCHARD_PROXY_TARGET=https://orbitcloud-cms.fly.dev` (must be **https**
     and publicly reachable — the proxy pins this origin)
   - `ABRIT_TRUSTED_PUBLIC_HOSTS=orbitcloud.vercel.app`
   - leave `ABRIT_TRUST_PROXY_HEADERS` unset (default)
   Then **redeploy** the portal.
9. **Verify**: `https://orbitcloud.vercel.app/admin` → Orchard login (Orbit
   branding) → dashboard KPIs populate through the service token.

## Operational notes

- **Media**: uploads land on the Fly volume and survive deploys. Through the
  Vercel proxy, request bodies are capped at **4.5 MB** (Vercel platform
  limit) — for larger media, upload directly on the Fly URL.
- **Background jobs** (SMS outbox processor) need the machine **always-on**:
  disable auto-stop (`fly machine update --auto-stop=false`) or accept
  delayed SMS sends on cold starts.
- **Backups**: `fly volumes snapshot <volume-id>`; export the Neon DB
  regularly (`pg_dump`).
- **Security**: rotate `ABRIT_SERVICE_TOKEN` per deployment (both sides);
  never expose the CMS origin without the portal in front of it unless you
  intend direct admin access; keep `ASPNETCORE_ENVIRONMENT=Production`.
- **Railway quick path**: connect the GitHub repo, set Root Directory to
  `orchard/`, deploy via the Dockerfile, attach a volume at `/app/App_Data`,
  set the same secrets, then point `ORCHARD_PROXY_TARGET` at its public URL.
