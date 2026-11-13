#!/usr/bin/env bash
set -Eeuo pipefail

# COMPOSE_FILE may list several files ("base.yml deploy.yml oracle.yml"), the
# same way the deploy command invokes compose. Using a single file here is what
# produced orphan containers: the stack came up without the override that names
# the containers, so Docker re-created them with generated names.
COMPOSE_FILES="${COMPOSE_FILE:-docker-compose.yml}"
compose() {
  # Pin the project name: compose derives it from the working directory, and
  # inside the updater that derivation resolved to a project with no running
  # containers, so "exec postgres" reported the service as not running.
  # shellcheck disable=SC2086
  docker compose --project-name "${COMPOSE_PROJECT_NAME:-marvelous-docs}" \
    $(for f in $COMPOSE_FILES; do printf -- "-f %s " "$f"; done) "$@"
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
# Retention. Every run writes a pre-update-<stamp>.sql plus one copy of each
# compose file and .env, and nothing ever deleted them: one real deployment had
# 61 files and 21 MB after a month of repeated updates. Keep the newest
# BACKUP_KEEP sets and drop the rest.
KEEP="${BACKUP_KEEP:-5}"
if [ "$KEEP" -gt 0 ]; then
  ls -1 "$BACKUP_DIR" 2>/dev/null \
    | sed -n 's/^\(pre-update-[0-9]\{8\}-[0-9]\{6\}\)\..*/\1/p' \
    | sort -u | head -n -"$KEEP" \
    | while IFS= read -r set; do rm -f "$BACKUP_DIR/$set".*; done
  echo "==> keeping the newest $KEEP backup sets in $BACKUP_DIR"
fi

# Wait for the database, then dump through the container's own environment:
# the updater has no POSTGRES_USER of its own.
db_ready=0
db_error=''
for attempt in $(seq 1 30); do
  # Capture the reason instead of swallowing it: a silent retry loop hides the
  # difference between "still starting" and "the command is wrong".
  if db_error="$(compose exec -T postgres pg_isready 2>&1)"; then db_ready=1; break; fi
  sleep 2
done
if [ "$db_ready" -ne 1 ]; then
  echo "PostgreSQL did not become ready; aborting before any change." >&2
  echo "Last error: $db_error" >&2
  exit 1
fi

echo "Creating PostgreSQL backup: $backup_file"
compose exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$backup_file"

# Apply the tags the agent resolved, now that the pre-update snapshot exists and a
# rollback would restore what was actually running. The file is written by the
# agent; a run started by hand simply has none and keeps the current tags.
TARGET_FILE="${UPDATE_TARGET_FILE:-./.update-target.env}"
if [ -f "$TARGET_FILE" ]; then
  echo "==> applying release target from $TARGET_FILE"
  while IFS='=' read -r key value; do
    case "$key" in ''|\#*) continue ;; esac
    [ -n "$value" ] || continue
    if grep -q "^${key}=" .env 2>/dev/null; then
      sed "s|^${key}=.*|${key}=${value}|" .env > .env.tmp && mv .env.tmp .env
    else
      printf '%s=%s\n' "$key" "$value" >> .env
    fi
  done < "$TARGET_FILE"
  rm -f "$TARGET_FILE"
fi

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
