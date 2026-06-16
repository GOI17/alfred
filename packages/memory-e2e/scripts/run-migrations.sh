#!/usr/bin/env bash
set -euo pipefail

# Run Alfred Memory SQL migrations against the PostgreSQL container.
# Falls back to a Node.js runner if psql is not installed locally.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../.env" 2>/dev/null || true

DATABASE_URL="${DATABASE_URL:-postgres://alfred:change_me_in_env_file@localhost:5432/alfred_memory}"
MIGRATIONS_DIR="${SCRIPT_DIR}/../../memory/migrations"

if command -v psql >/dev/null 2>&1; then
  for file in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
    echo "Applying $(basename "$file")"
    psql "$DATABASE_URL" -f "$file"
  done
else
  echo "psql not found; running migrations with Node.js + pg"
  DATABASE_URL="$DATABASE_URL" node "$SCRIPT_DIR/run-migrations.mjs" "$MIGRATIONS_DIR"
fi

echo "Migrations applied."
