#!/bin/bash
# Keeps the AbrITPortal Orchard process alive; restarts on exit.
#
# Secrets: the portal⇄CMS service token is injected as an environment
# variable (ASP.NET config key AbrIT__CommerceApi__ServiceToken) sourced from
# the project .env — NEVER committed to appsettings.json anymore.
cd /home/z/my-project/orchard/AbrITPortal
while true; do
  if ! pgrep -f "AbrITPortal.dll" > /dev/null; then
    echo "[$(date '+%F %T')] starting AbrITPortal..." >> /home/z/my-project/orchard-runtime.log
    set -a
    # shellcheck disable=SC1091
    source /home/z/my-project/.env 2>/dev/null
    set +a
    ASPNETCORE_ENVIRONMENT=Production ASPNETCORE_URLS=http://127.0.0.1:5000 \
      ABRIT_ORCHARD_COMMERCE_TOKEN="$ABRIT_SERVICE_TOKEN" \
      AbrIT__CommerceApi__ServiceToken="$ABRIT_SERVICE_TOKEN" \
      AbrIT__CommerceApi__BaseUrl="${ABRIT_ORCHARD_COMMERCE_BASE_URL:-http://127.0.0.1:3000}" \
      /home/z/dotnet/dotnet bin/Debug/net10.0/AbrITPortal.dll >> /home/z/my-project/orchard-runtime.log 2>&1
  fi
  sleep 5
done
