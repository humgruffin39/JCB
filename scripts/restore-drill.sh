#!/bin/sh
set -eu

drill_directory=$(mktemp -d)
restored_database="${drill_directory}/restored.sqlite"

cleanup() {
  case "$drill_directory" in
    /tmp/*) rm -rf -- "$drill_directory" ;;
    *) echo "Unexpected drill directory; preserving ${drill_directory}" >&2 ;;
  esac
}
trap cleanup EXIT INT TERM

litestream restore \
  -config /tmp/litestream.yml \
  -integrity-check full \
  -o "$restored_database" \
  "$DATABASE_PATH"

node /app/apps/server/dist/record-restore-drill.js "$restored_database"
