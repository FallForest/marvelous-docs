#!/bin/sh
# Restore a Marvelous Docs deployment from the artifacts written by backup.sh.
#
# Usage: ./scripts/deploy/restore.sh <database.sql> [uploads.tar.gz]
# The database dump is applied with psql ON_ERROR_STOP=1, the uploads archive is
# extracted over the uploads volume, then api and web are started again.
# Environment: COMPOSE_FILE
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

usage() {
  echo "usage: $0 <database.sql> [uploads.tar.gz]" >&2
  exit 2
}

[ "$#" -ge 1 ] || usage
sql_file="$1"
uploads_file="${2:-}"

[ -f "$COMPOSE_FILE" ] || { echo "restore: compose file not found: $COMPOSE_FILE" >&2; exit 1; }
[ -f "$sql_file" ] || { echo "restore: database dump not found: $sql_file" >&2; exit 1; }
if [ -n "$uploads_file" ] && [ ! -f "$uploads_file" ]; then
  echo "restore: uploads archive not found: $uploads_file" >&2
  exit 1
fi

echo "==> Stopping application containers"
docker compose -f "$COMPOSE_FILE" stop api web || true

echo "==> Restoring database from $sql_file"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"' < "$sql_file"

if [ -n "$uploads_file" ]; then
  sql_dir="$(cd "$(dirname "$sql_file")" && pwd)"
  uploads_file="$(cd "$(dirname "$uploads_file")" && pwd)/$(basename "$uploads_file")"
  echo "==> Restoring uploads from $uploads_file"
  upload_volume="$(docker volume ls -q --filter label=com.docker.compose.volume=uploads_data | head -n 1)"
  if [ -n "$upload_volume" ]; then
    docker run --rm \
      -v "$upload_volume:/data" \
      -v "$sql_dir:/backup:ro" \
      postgres:16-alpine sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$uploads_file") -C /data"
  else
    echo "restore: uploads volume not found; extract the archive into the api container manually" >&2
  fi
else
  echo "==> Skipping uploads (no archive given)"
fi

echo "==> Starting application containers"
docker compose -f "$COMPOSE_FILE" up -d api web

echo "==> Waiting for the API health check"
attempt=0
while [ "$attempt" -lt 30 ]; do
  if docker compose -f "$COMPOSE_FILE" exec -T api \
    node -e "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
    echo "==> Restore complete"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done

echo "restore: health check did not pass; inspect 'docker compose logs api'" >&2
exit 1
