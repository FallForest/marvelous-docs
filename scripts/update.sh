#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%d-%H%M%S)"
backup_file="$BACKUP_DIR/pre-update-$timestamp.sql"

echo "Creating PostgreSQL backup: $backup_file"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$backup_file"

echo "Pulling configured images"
docker compose -f "$COMPOSE_FILE" pull api web

echo "Applying database migrations"
docker compose -f "$COMPOSE_FILE" run --rm api npm run db:migrate

echo "Restarting application"
docker compose -f "$COMPOSE_FILE" up -d api web caddy

echo "Waiting for health check"
for attempt in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T api node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "Update completed successfully"
    exit 0
  fi
  sleep 2
done

echo "Health check failed. Restore $backup_file and roll back the image tags." >&2
exit 1
