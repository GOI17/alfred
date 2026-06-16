#!/usr/bin/env bash
set -euo pipefail

# Run Alfred Memory SQL migrations against the PostgreSQL container.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../.env" 2>/dev/null || true

DATABASE_URL="${DATABASE_URL:-postgres://alfred:change_me_in_env_file@localhost:5432/alfred_memory}"
MIGRATIONS_DIR="${SCRIPT_DIR}/../../memory/migrations"

for file in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  echo "Applying $(basename "$file")"
  psql "$DATABASE_URL" -f "$file"
done

echo "Migrations applied."
