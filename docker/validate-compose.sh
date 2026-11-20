#!/usr/bin/env bash
# =============================================================================
# docker/validate-compose.sh — REAL Docker Compose validation (final-audit
# closure FSR-11).
#
# Runs `docker compose config` with the REAL Docker CLI (client-side only: no
# daemon, no containers, no images are needed — `config` renders and validates
# the merged model) and asserts the deployment contract on the RENDERED
# output, never on the raw YAML text:
#
#   1.  the base compose file (docker-compose.yml) renders without error
#   2.  base + development override (docker/compose.dev.yml) render without
#       error — including the `!override` ports tag (requires Compose v2.24+)
#   3.  the portal container environment carries the operator proxy-trust
#       contract variables (final-integration FSR-8):
#         ABRIT_TRUST_PROXY_HEADERS, ABRIT_TRUSTED_PUBLIC_HOSTS,
#         ORCHARD_PROXY_TIMEOUT_MS, ABRIT_PROXY_MAX_BODY_BYTES
#   4.  operator values set in the shell/.env actually REACH the rendered
#       container environment (end-to-end injection proof)
#   5.  PORTAL_BIND defaults: production 127.0.0.1 (loopback-only publish),
#       development override 0.0.0.0 (all interfaces)
#   6.  no UNWANTED public binding in the production render: the database
#       publishes no ports, and portal + cms publish only their documented
#       loopback mappings
#   7.  the internal CMS → portal wiring (AbrIT__CommerceApi__BaseUrl =
#       http://portal:3000) survives both renders
#   8.  the private network `abrit` and the four named volumes exist in both
#       renders
#
# Usage (from anywhere; the repo root is derived from this script's path):
#   bash docker/validate-compose.sh
#
# Requires: docker CLI with the compose plugin, jq. No Docker daemon, no
# network access, no real secrets — the three REQUIRED compose variables get
# obviously-fake placeholder values that are never printed.
#
# Exit status: 0 = all checks passed, 1 = at least one check failed.
# =============================================================================

set -u -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_COMPOSE="${REPO_ROOT}/docker-compose.yml"
DEV_COMPOSE="${REPO_ROOT}/docker/compose.dev.yml"

# Obviously-fake, non-secret placeholder values for the REQUIRED compose
# variables (`:?` interpolation). Never echoed anywhere.
export POSTGRES_PASSWORD='validate-compose-placeholder'
export OTP_HMAC_SECRET='validate-compose-placeholder'
export ABRIT_SERVICE_TOKEN='validate-compose-placeholder'

# Operator-contract variables must be ABSENT here so the default-value checks
# below observe the production defaults baked into docker-compose.yml.
unset ABRIT_TRUST_PROXY_HEADERS ABRIT_TRUSTED_PUBLIC_HOSTS \
      ORCHARD_PROXY_TIMEOUT_MS ABRIT_PROXY_MAX_BODY_BYTES \
      PORTAL_BIND PORTAL_PORT CMS_BIND CMS_PORT 2>/dev/null || true

FAILURES=0
pass() { printf '  [PASS] %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

command -v docker >/dev/null 2>&1 || { echo "docker CLI not found"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq not found"; exit 1; }

echo "== docker/validate-compose.sh (real Docker CLI, no daemon needed) =="
docker --version
COMPOSE_VERSION_OUTPUT="$(docker compose version 2>&1)" || { echo "$COMPOSE_VERSION_OUTPUT"; echo "docker compose plugin not available"; exit 1; }
echo "$COMPOSE_VERSION_OUTPUT"

# --- 0. Compose version floor (the dev override uses the `!override` tag) ---
# `!override` was introduced in Compose v2.24.0. Older releases do NOT error
# out — they silently MERGE the overridden ports list, producing a duplicate
# binding that fails at `docker compose up` time with "port is already
# allocated" (empirically verified against v2.20.3 and v2.23.3). The floor
# is therefore enforced explicitly, with the dev render checked for the
# duplicate below as a second line of defense.
COMPOSE_VERSION="$(echo "$COMPOSE_VERSION_OUTPUT" | sed -n 's/.*version v\([0-9][0-9]*\.[0-9][0-9]*\)[.0-9]*.*/\1/p' | head -1)"
COMPOSE_MAJOR="${COMPOSE_VERSION%%.*}"
COMPOSE_MINOR="${COMPOSE_VERSION#*.}"
if [ -z "$COMPOSE_VERSION" ]; then
  fail "could not parse the docker compose version from: $COMPOSE_VERSION_OUTPUT"
elif [ "$COMPOSE_MAJOR" -lt 2 ] || { [ "$COMPOSE_MAJOR" = "2" ] && [ "$COMPOSE_MINOR" -lt 24 ]; }; then
  fail "docker compose v$COMPOSE_VERSION is TOO OLD: docker/compose.dev.yml uses the !override tag which requires Compose v2.24.0+ (older versions silently mis-merge the ports)"
else
  pass "docker compose v$COMPOSE_VERSION meets the v2.24.0 floor required by docker/compose.dev.yml (!override tag)"
fi

# --- 1. Base compose renders ------------------------------------------------
echo "-- [1] base compose: docker compose -f docker-compose.yml config"
BASE_JSON="$(docker compose -f "$BASE_COMPOSE" config --format json 2>&1)" || {
  echo "$BASE_JSON"; fail "base compose config failed to render"; exit 1;
}
pass "base compose renders without error"

# --- 2. Base + dev override render (needs Compose v2.24+ for !override) ----
echo "-- [2] base + dev override: docker compose -f docker-compose.yml -f docker/compose.dev.yml config"
DEV_JSON="$(docker compose -f "$BASE_COMPOSE" -f "$DEV_COMPOSE" config --format json 2>&1)" || {
  echo "$DEV_JSON"; fail "base+dev compose config failed to render"; exit 1;
}
pass "base + dev override renders without error (Compose supports the !override tag)"

# --- helpers -----------------------------------------------------------------
portal_base_ports() { echo "$1" | jq -c '[.services.portal.ports[]? | {host_ip: (.host_ip // ""), target, published}]'; }
first_host_ip()     { echo "$1" | jq -r '.services.portal.ports[0].host_ip // ""'; }

# --- 3. Portal environment carries the proxy-trust contract (defaults) ------
echo "-- [3] portal environment: proxy-trust contract variables (FSR-8 wiring)"
check_env() { # $1=json $2=var $3=expected rendered default
  local actual
  actual="$(echo "$1" | jq -r --arg k "$2" '.services.portal.environment[$k] // "MISSING"')"
  if [ "$actual" = "$3" ]; then pass "$2 present with documented default (\"$3\")";
  else fail "$2: expected \"$3\", rendered \"$actual\""; fi
}
check_env "$BASE_JSON" ABRIT_TRUST_PROXY_HEADERS 'false'
check_env "$BASE_JSON" ABRIT_TRUSTED_PUBLIC_HOSTS ''
check_env "$BASE_JSON" ORCHARD_PROXY_TIMEOUT_MS ''
check_env "$BASE_JSON" ABRIT_PROXY_MAX_BODY_BYTES ''

# --- 4. Operator values reach the rendered environment (injection proof) ----
echo "-- [4] operator values injected into the rendered portal environment"
INJ_JSON="$(
  ABRIT_TRUST_PROXY_HEADERS='true' \
  ABRIT_TRUSTED_PUBLIC_HOSTS='portal.example.test' \
  ORCHARD_PROXY_TIMEOUT_MS='45000' \
  ABRIT_PROXY_MAX_BODY_BYTES='104857600' \
  PORTAL_BIND='0.0.0.0' \
  docker compose -f "$BASE_COMPOSE" config --format json 2>&1
)" || { echo "$INJ_JSON"; fail "operator-override render failed"; exit 1; }
check_inj() { # $1=var $2=expected
  local actual
  actual="$(echo "$INJ_JSON" | jq -r --arg k "$1" '.services.portal.environment[$k] // "MISSING"')"
  if [ "$actual" = "$2" ]; then pass "$1 → \"$2\" reached the container environment";
  else fail "$1: expected \"$2\", rendered \"$actual\""; fi
}
check_inj ABRIT_TRUST_PROXY_HEADERS 'true'
check_inj ABRIT_TRUSTED_PUBLIC_HOSTS 'portal.example.test'
check_inj ORCHARD_PROXY_TIMEOUT_MS '45000'
check_inj ABRIT_PROXY_MAX_BODY_BYTES '104857600'
INJ_HOST_IP="$(first_host_ip "$INJ_JSON")"
if [ "$INJ_HOST_IP" = "0.0.0.0" ]; then pass "explicit PORTAL_BIND=0.0.0.0 overrides the loopback default";
else fail "explicit PORTAL_BIND=0.0.0.0: rendered host_ip \"$INJ_HOST_IP\""; fi

# --- 5. PORTAL_BIND defaults -------------------------------------------------
echo "-- [5] PORTAL_BIND defaults (production loopback vs development override)"
BASE_HOST_IP="$(first_host_ip "$BASE_JSON")"
if [ "$BASE_HOST_IP" = "127.0.0.1" ]; then pass "production default: portal publishes on 127.0.0.1 (loopback only)";
else fail "production default host_ip: expected 127.0.0.1, rendered \"$BASE_HOST_IP\""; fi
DEV_HOST_IP="$(first_host_ip "$DEV_JSON")"
if [ "$DEV_HOST_IP" = "0.0.0.0" ]; then pass "development override: portal publishes on 0.0.0.0 (all interfaces)";
else fail "development override host_ip: expected 0.0.0.0, rendered \"$DEV_HOST_IP\""; fi
# The `!override` tag must REPLACE the base mapping, not merge with it — a
# Compose release older than 2.24.0 renders BOTH bindings here.
DEV_PORT_COUNT="$(echo "$DEV_JSON" | jq '.services.portal.ports | length')"
if [ "$DEV_PORT_COUNT" = "1" ]; then pass "development override REPLACED the base port binding (exactly 1 mapping — no !override mis-merge)";
else fail "development override produced $DEV_PORT_COUNT portal port mappings (expected 1): $(portal_base_ports "$DEV_JSON")"; fi

# --- 6. No unwanted public binding in production -----------------------------
echo "-- [6] production render publishes only the documented loopback ports"
DB_PORTS="$(echo "$BASE_JSON" | jq '.services.db.ports // [] | length')"
if [ "$DB_PORTS" = "0" ]; then pass "database publishes no host ports";
else fail "database unexpectedly publishes $DB_PORTS port mapping(s)"; fi
PORTAL_PUBLISH="$(portal_base_ports "$BASE_JSON")"
if [ "$PORTAL_PUBLISH" = '[{"host_ip":"127.0.0.1","target":3000,"published":"3000"}]' ]; then
  pass "portal publishes exactly 127.0.0.1:3000→3000"
else fail "unexpected portal port mapping(s): $PORTAL_PUBLISH"; fi
CMS_HOST_IP="$(echo "$BASE_JSON" | jq -r '.services.cms.ports[0].host_ip // ""')"
if [ "$CMS_HOST_IP" = "127.0.0.1" ]; then pass "cms debug port stays loopback-bound (127.0.0.1:5001→5000)";
else fail "cms debug host_ip: expected 127.0.0.1, rendered \"$CMS_HOST_IP\""; fi

# --- 7. Internal CMS → portal wiring -----------------------------------------
echo "-- [7] internal CMS → portal service wiring"
CMS_BASEURL_BASE="$(echo "$BASE_JSON"  | jq -r '.services.cms.environment.AbrIT__CommerceApi__BaseUrl // "MISSING"')"
CMS_BASEURL_DEV="$( echo "$DEV_JSON"  | jq -r '.services.cms.environment.AbrIT__CommerceApi__BaseUrl // "MISSING"')"
if [ "$CMS_BASEURL_BASE" = "http://portal:3000" ] && [ "$CMS_BASEURL_DEV" = "http://portal:3000" ]; then
  pass "cms reaches the portal internally at http://portal:3000 (base and dev)"
else fail "cms CommerceApi BaseUrl: base=\"$CMS_BASEURL_BASE\" dev=\"$CMS_BASEURL_DEV\""; fi

# --- 8. Networks and volumes preserved ---------------------------------------
echo "-- [8] private network and named volumes"
check_topology() { # $1=json $2=label
  local nets vols ok=1
  nets="$(echo "$1" | jq -r '(.networks | keys) | join(",")')"
  vols="$(echo "$1" | jq -r '(.volumes | keys) | sort | join(",")')"
  [ "$nets" = "abrit" ] || { fail "$2 network set: expected \"abrit\", got \"$nets\""; ok=0; }
  [ "$vols" = "cms_appdata,cms_data_protection_keys,cms_imagesharp_cache,pgdata" ] || { fail "$2 volume set: got \"$vols\""; ok=0; }
  [ "$ok" = "1" ] && pass "$2: network \"abrit\" + volumes pgdata/cms_appdata/cms_imagesharp_cache/cms_data_protection_keys present"
}
check_topology "$BASE_JSON" "base render"
check_topology "$DEV_JSON"  "dev-override render"

# --- summary -----------------------------------------------------------------
echo
if [ "$FAILURES" = "0" ]; then
  echo "RESULT: all compose validation checks PASSED"
  exit 0
else
  echo "RESULT: ${FAILURES} compose validation check(s) FAILED"
  exit 1
fi
