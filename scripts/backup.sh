#!/bin/sh
# Back up a Marvelous Docs deployment started with docker compose.
#
# Writes two files into BACKUP_DIR (default ./backups):
#   marvelous-docs-<UTC timestamp>.sql        pg_dump of the database
#   uploads-<UTC timestamp>.tar.gz            archive of the uploads volume
#
# Usage: ./scripts/backup.sh
# Environment: COMPOSE_FILE, BACKUP_DIR, UPLOAD_SERVICE (default: api)
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
UPLOAD_SERVICE="${UPLOAD_SERVICE:-api}"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "backup: compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
timestamp="$(date -u +%Y%m%d-%H%M%S)"
sql_file="$BACKUP_DIR/marvelous-docs-$timestamp.sql"
uploads_file="$BACKUP_DIR/uploads-$timestamp.tar.gz"

echo "==> Dumping PostgreSQL to $sql_file"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'pg_dump --no-owner --clean --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$sql_file"

echo "==> Archiving uploads to $uploads_file"
upload_volume="$(docker volume ls -q --filter label=com.docker.compose.volume=uploads_data | head -n 1)"
if [ -n "$upload_volume" ]; then
  docker run --rm \
    -v "$upload_volume:/data:ro" \
    -v "$BACKUP_DIR:/backup" \
    postgres:16-alpine sh -c "tar czf /backup/$(basename "$uploads_file") -C /data ."
else
  echo "    uploads volume not found; copying from the $UPLOAD_SERVICE container instead"
  docker compose -f "$COMPOSE_FILE" cp "$UPLOAD_SERVICE:/data/uploads" "$BACKUP_DIR/uploads-$timestamp"
  tar czf "$uploads_file" -C "$BACKUP_DIR" "uploads-$timestamp"
  rm -rf "$BACKUP_DIR/uploads-$timestamp"
fi

echo "==> Done"
echo "    database: $sql_file"
echo "    uploads:  $uploads_file"
echo "    restore:  ./scripts/restore.sh \"$sql_file\" \"$uploads_file\""
echo "Store the files off the server and test a restore regularly."
