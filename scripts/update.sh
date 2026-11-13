#!/usr/bin/env bash
set -Eeuo pipefail

# COMPOSE_FILE may list several files ("base.yml deploy.yml oracle.yml"), the
# same way the deploy command invokes compose. Using a single file here is what
# produced orphan containers: the stack came up without the override that names
# the containers, so Docker re-created them with generated names.
COMPOSE_FILES="${COMPOSE_FILE:-docker-compose.yml}"
compose() {
  # shellcheck disable=SC2086
  docker compose $(for f in $COMPOSE_FILES; do printf -- "-f %s " "$f"; done) "$@"
}
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%d-%H%M%S)"
backup_file="$BACKUP_DIR/pre-update-$timestamp.sql"

echo "Snapshotting compose files and env so a failed update can roll back"
for f in $COMPOSE_FILES; do
  cp "$f" "$BACKUP_DIR/pre-update-$timestamp.$(basename "$f")"
done
cp .env "$BACKUP_DIR/pre-update-$timestamp.env"

echo "Creating PostgreSQL backup: $backup_file"
compose exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$backup_file"

echo "Pulling configured images"
compose pull api web

echo "Building the in-app updater"
services="$(compose config --services)"
has_service() {
  printf '%s\n' "$services" | grep -Fxq "$1"
}
if has_service updater; then
  compose build updater
fi

# Recreate only the services that serve traffic.
#
# The updater must NOT be in this list. It runs inside the compose project, so
# "up -d updater" stops the very container executing this script: the shell got
# SIGKILL (exit 137), the health check never ran, and the roll back never fired.
restart_services=(api web)
if has_service caddy; then restart_services+=(caddy); fi

echo "Restarting application"
compose up -d --no-deps "${restart_services[@]}"

echo "Waiting for health check"
healthy=0
for attempt in $(seq 1 30); do
  if compose exec -T api node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    healthy=1
    break
  fi
  sleep 2
done

if [ "$healthy" -eq 1 ]; then
  echo "Update completed successfully"
  exit 0
fi

# A failed update must put the previous images back, or the stack is left
# half-upgraded and someone has to fix it by hand.
echo "Health check failed, rolling back to the previous image tags" >&2
first_snapshot="$BACKUP_DIR/pre-update-$timestamp.$(basename "$(echo "$COMPOSE_FILES" | cut -d' ' -f1)")"
if [ -f "$first_snapshot" ]; then
  for f in $COMPOSE_FILES; do
    snap="$BACKUP_DIR/pre-update-$timestamp.$(basename "$f")"
    [ -f "$snap" ] && cp "$snap" "$f"
  done
  [ -f "$BACKUP_DIR/pre-update-$timestamp.env" ] && cp "$BACKUP_DIR/pre-update-$timestamp.env" .env
  compose up -d --no-deps "${restart_services[@]}" || true
  echo "Rolled back. Database backup kept at $backup_file" >&2
else
  echo "No compose backup found; restore $backup_file and the image tags manually." >&2
fi
exit 1
