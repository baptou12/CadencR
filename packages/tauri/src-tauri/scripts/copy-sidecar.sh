#!/bin/bash
# Copies the cadence-service binary to src-tauri/binaries/ with the correct target triple suffix.
# Usage: ./copy-sidecar.sh [target-triple]
# Example: ./copy-sidecar.sh aarch64-apple-darwin

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARIES_DIR="$SCRIPT_DIR/../binaries"
TARGET_TRIPLE="${1:-$(rustc -vV | sed -n 's|host: ||p')}"

REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SERVICE_BIN="$REPO_ROOT/target/release/cadence-service"

if [ ! -f "$SERVICE_BIN" ]; then
  SERVICE_BIN="$REPO_ROOT/target/debug/cadence-service"
fi

if [ ! -f "$SERVICE_BIN" ]; then
  echo "cadence-service binary not found — building it..."
  (cd "$REPO_ROOT" && cargo build --release -p cadence-service)
  SERVICE_BIN="$REPO_ROOT/target/release/cadence-service"
fi

mkdir -p "$BINARIES_DIR"
DEST="$BINARIES_DIR/cadence-service-$TARGET_TRIPLE"
if [ ! -f "$DEST" ] || [ "$SERVICE_BIN" -nt "$DEST" ]; then
  rm -f "$DEST"
  cp "$SERVICE_BIN" "$DEST"
  echo "Copied cadence-service to binaries/cadence-service-$TARGET_TRIPLE"
else
  echo "Sidecar binary is up to date"
fi
