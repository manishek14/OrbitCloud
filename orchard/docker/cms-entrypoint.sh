#!/bin/sh
set -eu

# Named volumes may already contain root-owned Orchard data from older images.
# Change ownership only where needed; never replace or remove tenant files.
for directory in /app/App_Data /var/lib/abrit-portal/imagesharp-cache /var/lib/abrit-portal/data-protection-keys; do
    mkdir -p "$directory"
    find "$directory" \( ! -user abrit -o ! -group abrit \) -exec chown abrit:abrit {} +
done

exec gosu abrit "$@"
