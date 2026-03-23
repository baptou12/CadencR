#!/bin/bash
# Copies the cadence-service binary to src-tauri/binaries/ with the correct target triple suffix.
# Usage: ./copy-sidecar.sh [target-triple]
# Example: ./copy-sidecar.sh aarch64-apple-darwin

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARIES_DIR="$SCRIPT_DIR/../binaries"
TARGET_TRIPLE="${1:-$(rustc -vV | sed -n 's|host: ||p')}"

SERVICE_BIN="$(cd "$SCRIPT_DIR/../../../.." && pwd)/target/release/cadence-service"

if [ ! -f "$SERVICE_BIN" ]; then
  echo "Error: cadence-service binary not found at $SERVICE_BIN"
  echo "Build it first: cargo build --release -p cadence-service"
  exit 1
fi

mkdir -p "$BINARIES_DIR"
cp "$SERVICE_BIN" "$BINARIES_DIR/cadence-service-$TARGET_TRIPLE"
echo "Copied cadence-service to binaries/cadence-service-$TARGET_TRIPLE"
