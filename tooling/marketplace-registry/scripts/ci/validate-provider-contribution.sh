#!/bin/sh
set -eu

if [ "$#" -ne 4 ]; then
  echo "usage: validate-provider-contribution.sh <trusted-pin.env> <base> <candidate> <validate|tooling>" >&2
  exit 2
fi
pin_file=$1
base=$2
candidate=$3
mode=$4
case "$mode" in validate|tooling) ;; *) echo "unknown validation mode: $mode" >&2; exit 2 ;; esac

work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/cadencr-registry-validator.XXXXXX")
# A released executable may create unexpected state, including a database.
# Retain the entire owned directory on every outcome rather than deleting it.
printf 'Registry validation scratch retained at: %s\n' "$work" >&2
trap 'exit 1' HUP INT TERM
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
bootstrap_status=0
binary=$(sh "$script_dir/fetch-released-cli.sh" "$pin_file" "$work/released") || bootstrap_status=$?
[ "$bootstrap_status" -eq 0 ] || exit "$bootstrap_status"

"$binary" registry validate --base "$base" --candidate "$candidate"
if [ "$mode" = tooling ]; then
  set -- "$candidate"/packages/*.json
  if [ ! -e "$1" ]; then
    echo "No publishable package JSON; skipping index assembly."
    exit 0
  fi
  generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  expires_at=$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%SZ)
  "$binary" registry build-index --schema-version 2 --packages "$candidate/packages" \
    --generated-at "$generated_at" --expires-at "$expires_at" \
    --output "${RUNNER_TEMP:-/tmp}/managed-index.json"
fi
