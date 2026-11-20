#!/bin/bash
# Keeps the AbrITPortal Orchard process alive during LOCAL development;
# restarts on exit. Production runs the containerized CMS (docker-compose),
# never this script.
#
# Usage, from the repository root:
#   ./orchard-watchdog.sh
#
# Secrets: the portal⇄CMS service token is injected as an environment
# variable (ASP.NET config key AbrIT__CommerceApi__ServiceToken) sourced from
# the project .env — NEVER committed to appsettings.json.
#
# NOTE (full-remediation audit §7): this script previously hard-coded a
# sandbox path (/home/z/my-project) that does not exist in this repository;
# it now resolves its own repository-relative location.
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTAL_DIR="$REPO_ROOT/orchard/AbrITPortal"
RUNTIME_LOG="$REPO_ROOT/orchard-runtime.log"

[ -f "$REPO_ROOT/.env" ] || { echo "No .env found at $REPO_ROOT — copy .env.example first." >&2; exit 1; }

cd "$PORTAL_DIR" || exit 1
while true; do
  if ! pgrep -f "AbrITPortal.dll" > /dev/null; then
    echo "[$(date '+%F %T')] starting AbrITPortal..." >> "$RUNTIME_LOG"
    set -a
    # shellcheck disable=SC1091
    source "$REPO_ROOT/.env" 2>/dev/null
    set +a
    ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://127.0.0.1:5000 \
      AbrIT__CommerceApi__ServiceToken="$ABRIT_SERVICE_TOKEN" \
      AbrIT__CommerceApi__BaseUrl="${ABRIT_ORCHARD_COMERCE_BASE_URL:-http://127.0.0.1:3000}" \
      dotnet bin/Debug/net10.0/AbrITPortal.dll >> "$RUNTIME_LOG" 2>&1
  fi
  sleep 5
done
