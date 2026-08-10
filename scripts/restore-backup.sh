#!/bin/sh
set -eu

target_path=${1:-}
restore_timestamp=${2:-}

if [ -z "$target_path" ]; then
  echo "Usage: restore-backup.sh TARGET_PATH [RFC3339_TIMESTAMP]" >&2
  exit 2
fi

case "$target_path" in
  /*) ;;
  *)
    echo "TARGET_PATH must be absolute." >&2
    exit 2
    ;;
esac

if [ -e "$target_path" ] || [ -e "${target_path}-wal" ] || [ -e "${target_path}-shm" ]; then
  echo "Refusing to overwrite an existing database or SQLite sidecar." >&2
  exit 2
fi

if [ -n "$restore_timestamp" ]; then
  exec litestream restore \
    -config /etc/litestream.yml \
    -integrity-check full \
    -timestamp "$restore_timestamp" \
    -o "$target_path" \
    "$DATABASE_PATH"
fi

exec litestream restore \
  -config /etc/litestream.yml \
  -integrity-check full \
  -o "$target_path" \
  "$DATABASE_PATH"
