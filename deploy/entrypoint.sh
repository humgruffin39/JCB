#!/bin/sh
set -eu

: "${DATABASE_PATH:?DATABASE_PATH is required}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
: "${R2_BACKUP_BUCKET:?R2_BACKUP_BUCKET is required}"

database_directory=$(dirname "$DATABASE_PATH")
case "$database_directory" in
  /data | /data/*) ;;
  *)
    echo "DATABASE_PATH must stay below /data in the production container." >&2
    exit 1
    ;;
esac
mkdir -p "$database_directory"
chown -R node:node "$database_directory"

gosu node litestream restore \
  -if-db-not-exists \
  -if-replica-exists \
  -integrity-check full \
  -config /etc/litestream.template.yml \
  "$DATABASE_PATH"

gosu node node /app/apps/server/dist/render-litestream-config.js \
  /etc/litestream.template.yml \
  /tmp/litestream.yml \
  "$DATABASE_PATH"

exec gosu node litestream replicate \
  -config /tmp/litestream.yml \
  -exec "node /app/apps/server/dist/index.js"
