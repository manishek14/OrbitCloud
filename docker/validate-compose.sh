#!/usr/bin/env bash
# =============================================================================
# docker/validate-compose.sh — REAL Docker Compose validation (final-audit
# closure FSR-11; compose environment isolation FSR-13).
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
#   4.  operator values set in the shell actually REACH the rendered
#       container environment (end-to-end injection proof)
#   5.  PORTAL_BIND defaults: production 127.0.0.1 (loopback-only publish),
#       development override 0.0.0.0 (all interfaces)
#   6.  no UNWANTED public binding in the production render: the database
#       publishes no ports, and portal + cms publish only their documented
#       loopback mappings (PORTAL_BIND / PORTAL_PORT / CMS_BIND / CMS_PORT
#       defaults)
#   7.  the internal CMS → portal wiring (AbrIT__CommerceApi__BaseUrl =
#       http://portal:3000) survives both renders
#   8.  the private network `abrit` and the four named volumes exist in both
#       renders
#
# FSR-13 — environment isolation: EVERY `docker compose config` invocation in
# this script is pinned to an EMPTY temporary env file via `--env-file`.
# Without it, Compose auto-loads the project `.env` (the directory of the
# first `-f` file) for interpolation, so a developer's real `.env` (e.g.
# PORTAL_BIND=0.0.0.0) would silently change what the "default value" checks
# observe — the validation would test the local machine, not the repository.
# The empty file replaces that auto-load for ALL validation groups (base
# compose, base + dev override, operator environment injection).
# Shell-exported variables take PRECEDENCE over env files in Compose
# interpolation, so (a) the obviously-fake placeholders still satisfy the
# three REQUIRED (`:?`) variables and (b) the operator-injection values of
# check [4] — taken from the process environment — still reach the render.
# COMPOSE_ENV_FILES (another env-file influence path) is unset as well.
# No content of any real `.env` is read, modified, deleted or printed here.
#
# Usage (from anywhere; the repo root is derived from this script's path):
#   bash docker/validate-compose.sh               # validate the repository
#                                                # compose files
#   bash docker/validate-compose.sh --self-test   # FSR-13 isolation proof
#                                                # (sandboxed, see below)
#
# The --self-test mode NEVER touches a real `.env`: it copies the two compose
# files into a throwaway sandbox directory, writes an ADVERSARIAL `.env`
# there (values that differ from both the compose defaults and the
# operator-injection values), first proves with a NEGATIVE CONTROL (a render
# WITHOUT `--env-file`) that the sandbox `.env` really does leak into the
# interpolation — so the setup is a valid test — and then re-runs the full
# validation against the sandbox, where every check must still pass. That is
# only possible if the empty-env-file isolation actually works.
#
# Requires: docker CLI with the compose plugin, jq. No Docker daemon, no
# network access, no real secrets — the three REQUIRED compose variables get
# obviously-fake placeholder values that are never printed.
#
# Exit status: 0 = all checks passed, 1 = at least one check failed.
# =============================================================================

set -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Internal override, set ONLY by the --self-test re-invocation below to point
# the full validation at a sandboxed copy of the compose files. Never set it
# by hand.
REPO_ROOT="${ABRIT_VALIDATE_COMPOSE_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
BASE_COMPOSE="${REPO_ROOT}/docker-compose.yml"
DEV_COMPOSE="${REPO_ROOT}/docker/compose.dev.yml"

# --- FSR-13: empty temporary env file, cleaned on EVERY exit path -----------
EMPTY_ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/abrit-validate-compose.env.XXXXXX")" || {
  echo "could not create the temporary empty env file" >&2
  exit 1
}
SELF_TEST_DIR="" # set (and cleaned up) only by --self-test below
cleanup() {
  if [ -n "$SELF_TEST_DIR" ]; then rm -rf "$SELF_TEST_DIR"; fi
  rm -f "$EMPTY_ENV_FILE"
  return 0 # a cleanup trap must never mask the script's real exit status
}
trap cleanup EXIT
trap 'exit 130' INT  # ^C    -> EXIT trap -> cleanup
trap 'exit 143' TERM # kill  -> EXIT trap -> cleanup
trap 'exit 129' HUP  # hangup -> EXIT trap -> cleanup

# Obviously-fake, non-secret placeholder values for the REQUIRED compose
# variables (`:?` interpolation). Never echoed anywhere. Shell-exported
# variables WIN over env files in Compose interpolation, so these
# placeholders are exactly what the renders below see — a real `.env` can
# neither supply nor shadow them.
export POSTGRES_PASSWORD='validate-compose-placeholder'
export OTP_HMAC_SECRET='validate-compose-placeholder'
export ABRIT_SERVICE_TOKEN='validate-compose-placeholder'

# Operator-contract variables must be ABSENT here so the default-value checks
# below observe the production defaults baked into docker-compose.yml.
# COMPOSE_ENV_FILES is unset as well: it is another env-file influence path
# (it replaces the default `.env` lookup when --env-file is absent) and would
# make both the renders and the --self-test negative control depend on the
# invoking shell's environment.
unset ABRIT_TRUST_PROXY_HEADERS ABRIT_TRUSTED_PUBLIC_HOSTS \
      ORCHARD_PROXY_TIMEOUT_MS ABRIT_PROXY_MAX_BODY_BYTES \
      PORTAL_BIND PORTAL_PORT CMS_BIND CMS_PORT COMPOSE_ENV_FILES 2>/dev/null || true

FAILURES=0
pass() { printf '  [PASS] %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

command -v docker >/dev/null 2>&1 || { echo "docker CLI not found"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq not found"; exit 1; }

# --- 0a. FSR-13 self-test mode (sandboxed adversarial .env isolation proof) --
if [ "${1:-}" = "--self-test" ]; then
  echo "== docker/validate-compose.sh --self-test (FSR-13: adversarial .env isolation proof) =="

  SELF_TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/abrit-compose-selftest.XXXXXX")" || {
    echo "could not create the self-test sandbox"; exit 1;
  }
  SANDBOX="$SELF_TEST_DIR"
  mkdir -p "$SANDBOX/docker"
  cp "$SCRIPT_DIR/../docker-compose.yml" "$SANDBOX/docker-compose.yml" || {
    echo "could not copy docker-compose.yml into the sandbox"; exit 1;
  }
  cp "$SCRIPT_DIR/compose.dev.yml" "$SANDBOX/docker/compose.dev.yml" || {
    echo "could not copy docker/compose.dev.yml into the sandbox"; exit 1;
  }

  # Adversarial .env: every operator value differs from BOTH the compose
  # defaults AND the operator-injection values used by check [4], so any leak
  # is always observable. The three REQUIRED values differ from the script's
  # shell-exported placeholders to prove shell-over-env-file precedence.
  cat > "$SANDBOX/.env" <<'ADVERSARIAL_ENV'
ABRIT_TRUST_PROXY_HEADERS=from-env-file
ABRIT_TRUSTED_PUBLIC_HOSTS=adversarial-public-hosts.invalid
ORCHARD_PROXY_TIMEOUT_MS=999999
ABRIT_PROXY_MAX_BODY_BYTES=88888888
PORTAL_BIND=192.0.2.123
PORTAL_PORT=4000
CMS_BIND=0.0.0.0
CMS_PORT=6000
POSTGRES_PASSWORD=adversarial-postgres-password
OTP_HMAC_SECRET=adversarial-otp-secret
ABRIT_SERVICE_TOKEN=adversarial-service-token
ADVERSARIAL_ENV
  echo "   sandbox: $SANDBOX (an adversarial .env with values that differ from"
  echo "             every compose default and every operator-injection value)"

  # NEGATIVE CONTROL — render WITHOUT --env-file and assert the adversarial
  # values DO leak through. This proves the sandbox .env is genuinely in the
  # interpolation path, so the isolation proof below is not vacuous.
  echo "-- [self-test control] WITHOUT --env-file the adversarial .env MUST leak (proves the setup is a valid test)"
  CONTROL_JSON="$(docker compose -f "$SANDBOX/docker-compose.yml" config --format json 2>&1)" || {
    echo "$CONTROL_JSON"; echo "self-test control render failed"; exit 1;
  }
  control_leak() { # $1=jq filter $2=expected adversarial value $3=label
    local actual
    actual="$(echo "$CONTROL_JSON" | jq -r "$1")"
    if [ "$actual" = "$2" ]; then
      pass "control: $3 leaked its adversarial value — the sandbox .env IS in the interpolation path"
    else
      fail "control: $3 did NOT leak (expected \"$2\", rendered \"$actual\") — sandbox .env not consulted; the isolation proof would be vacuous"
    fi
  }
  control_leak '.services.portal.environment.ABRIT_TRUST_PROXY_HEADERS'  'from-env-file'                  'ABRIT_TRUST_PROXY_HEADERS'
  control_leak '.services.portal.environment.ABRIT_TRUSTED_PUBLIC_HOSTS' 'adversarial-public-hosts.invalid' 'ABRIT_TRUSTED_PUBLIC_HOSTS'
  control_leak '.services.portal.environment.ORCHARD_PROXY_TIMEOUT_MS'   '999999'                         'ORCHARD_PROXY_TIMEOUT_MS'
  control_leak '.services.portal.environment.ABRIT_PROXY_MAX_BODY_BYTES' '88888888'                       'ABRIT_PROXY_MAX_BODY_BYTES'
  control_leak '.services.portal.ports[0].host_ip'                       '192.0.2.123'                    'PORTAL_BIND'
  control_leak '.services.portal.ports[0].published | tostring'           '4000'                           'PORTAL_PORT'
  control_leak '.services.cms.ports[0].host_ip'                          '0.0.0.0'                        'CMS_BIND'
  control_leak '.services.cms.ports[0].published | tostring'              '6000'                           'CMS_PORT'
  # Shell-over-env-file precedence for the REQUIRED variables: the render must
  # carry the script's fake placeholder, not the adversarial .env value (the
  # placeholder itself is never printed).
  CONTROL_REQ_PW="$(echo "$CONTROL_JSON" | jq -r '.services.db.environment.POSTGRES_PASSWORD')"
  if [ "$CONTROL_REQ_PW" = "$POSTGRES_PASSWORD" ]; then
    pass "control: REQUIRED POSTGRES_PASSWORD still comes from the shell placeholder (shell wins over .env)"
  else
    fail "control: REQUIRED POSTGRES_PASSWORD did not come from the shell placeholder"
  fi

  # POSITIVE PROOF — re-run the FULL validation against the sandbox (which
  # still contains the adversarial .env). Every default check can only pass
  # if the empty-env-file isolation prevents the .env from being consulted.
  echo "-- [self-test proof] the SAME sandbox validated with the empty --env-file isolation (every check must pass)"
  if ABRIT_VALIDATE_COMPOSE_DIR="$SANDBOX" bash "${SCRIPT_DIR}/validate-compose.sh"; then
    pass "full validation passed against the sandbox WITH an adversarial .env present — defaults come from the compose files, not .env"
  else
    fail "validation against the sandbox failed — the adversarial .env influenced the render (isolation regression)"
  fi

  echo
  if [ "$FAILURES" = "0" ]; then
    echo "RESULT: FSR-13 self-test PASSED (an adversarial .env is proven harmless to the validation)"
    exit 0
  else
    echo "RESULT: ${FAILURES} FSR-13 self-test check(s) FAILED"
    exit 1
  fi
fi

# --- 0b. Banner --------------------------------------------------------------
echo "== docker/validate-compose.sh (real Docker CLI, no daemon needed) =="
if [ -n "${ABRIT_VALIDATE_COMPOSE_DIR:-}" ]; then
  echo "   FSR-13 self-test inner run: validating $REPO_ROOT (adversarial .env present, isolated via the empty env file)"
fi
docker --version
COMPOSE_VERSION_OUTPUT="$(docker compose version 2>&1)" || { echo "$COMPOSE_VERSION_OUTPUT"; echo "docker compose plugin not available"; exit 1; }
echo "$COMPOSE_VERSION_OUTPUT"

# --- 0c. Compose version floor (the dev override uses the `!override` tag) ---
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

# --- 1. Base compose renders -------------------------------------------------
echo "-- [1] base compose: docker compose --env-file <empty> -f docker-compose.yml config"
BASE_JSON="$(docker compose --env-file "$EMPTY_ENV_FILE" -f "$BASE_COMPOSE" config --format json 2>&1)" || {
  echo "$BASE_JSON"; fail "base compose config failed to render"; exit 1;
}
pass "base compose renders without error (isolated from any project .env by the empty env file)"

# --- 2. Base + dev override render (needs Compose v2.24+ for !override) -----
echo "-- [2] base + dev override: docker compose --env-file <empty> -f docker-compose.yml -f docker/compose.dev.yml config"
DEV_JSON="$(docker compose --env-file "$EMPTY_ENV_FILE" -f "$BASE_COMPOSE" -f "$DEV_COMPOSE" config --format json 2>&1)" || {
  echo "$DEV_JSON"; fail "base+dev compose config failed to render"; exit 1;
}
pass "base + dev override renders without error (Compose supports the !override tag; isolated from any project .env by the empty env file)"

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
# The values are set ONLY in this process's environment (the inline
# assignments below). Shell variables take precedence over env files in
# Compose interpolation, so the empty env file cannot block them — and with
# an adversarial .env present this check simultaneously proves that the
# injection prefers the operator's shell values over any .env content.
echo "-- [4] operator values injected into the rendered portal environment"
INJ_JSON="$(
  ABRIT_TRUST_PROXY_HEADERS='true' \
  ABRIT_TRUSTED_PUBLIC_HOSTS='portal.example.test' \
  ORCHARD_PROXY_TIMEOUT_MS='45000' \
  ABRIT_PROXY_MAX_BODY_BYTES='104857600' \
  PORTAL_BIND='0.0.0.0' \
  docker compose --env-file "$EMPTY_ENV_FILE" -f "$BASE_COMPOSE" config --format json 2>&1
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
  pass "portal publishes exactly 127.0.0.1:3000→3000 (PORTAL_BIND + PORTAL_PORT defaults)"
else fail "unexpected portal port mapping(s): $PORTAL_PUBLISH"; fi
CMS_PUBLISH="$(echo "$BASE_JSON" | jq -c '[.services.cms.ports[]? | {host_ip: (.host_ip // ""), target, published}]')"
if [ "$CMS_PUBLISH" = '[{"host_ip":"127.0.0.1","target":5000,"published":"5001"}]' ]; then
  pass "cms publishes exactly 127.0.0.1:5001→5000 (CMS_BIND + CMS_PORT defaults)"
else fail "unexpected cms port mapping(s): $CMS_PUBLISH"; fi

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
