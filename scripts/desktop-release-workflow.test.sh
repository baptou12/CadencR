#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "desktop-release-workflow.test: $*" >&2
  exit 1
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workflow="$repo_root/.github/workflows/desktop-release.yml"
[ -f "$workflow" ] || fail "missing workflow: $workflow"

workflow_text="$(cat "$workflow")"
case "$workflow_text" in
  *"--publish always"*)
    fail "desktop release workflow must not let electron-builder publish directly"
    ;;
esac

# The CLI is released on its own (cli-release.yml, tag cli/vX.Y.Z), so the app
# release neither builds it nor requires it to carry the app version.
case "$workflow_text" in
  *"-p cadencr-cli"*|*"package-cli-release.sh"*|*'cadencr-${RELEASE_TAG}-'*|*"unknown-linux-gnu"*)
    fail "desktop release workflow must not build or attach the CLI"
    ;;
esac

if grep -Eq '^packages/cli/' "$repo_root/scripts/release.sh"; then
  fail "release preflight must not require the CLI package version to match the app tag"
fi

case "$workflow_text" in
  *"--publish never"*) ;;
  *) fail "desktop release workflow must build with electron-builder --publish never" ;;
esac

case "$workflow_text" in
  *"Create draft GitHub release"*) ;;
  *) fail "workflow must create exactly one draft GitHub release via gh" ;;
esac

case "$workflow_text" in
  *"Verify uploaded GitHub release assets"*) ;;
  *) fail "workflow must verify uploaded GitHub release assets before publishing" ;;
esac

case "$workflow_text" in
  *"latest-mac.yml"*"Cadencr-\${version}-x64-mac.zip"*"Cadencr-\${version}-arm64-mac.zip"*"Cadencr-\${version}-x64.dmg"*"Cadencr-\${version}-arm64.dmg"*) ;;
  *) fail "workflow must require updater metadata and both arch-suffixed Homebrew DMGs" ;;
esac

case "$workflow_text" in
  *'Cadencr-${version}.dmg'*|*'Cadencr-${version}-mac.zip'*)
    fail "macOS assets must carry their arch; the unsuffixed names were the Intel build"
    ;;
esac

case "$workflow_text" in
  *'for arch in arm64 x64; do'*'smoke:packaged-sidecar'*'resources/bin/$arch/cadencr-service'*) ;;
  *) fail "workflow must smoke test both per-arch service sidecars" ;;
esac

case "$workflow_text" in
  *'CADENCR_MANAGED_THEME_INDEX_URL: ${{ vars.CADENCR_MANAGED_THEME_INDEX_URL }}'*'Validate marketplace build configuration'*'node scripts/validate-marketplace-build-env.mjs -- pnpm --filter @cadencr/service build:macos-sidecars'*) ;;
  *) fail "desktop sidecar must validate and forward optional mixed theme feed configuration" ;;
esac

case "$workflow_text" in
  *"  linux:"*"runs-on: ubuntu-22.04"*"pnpm --filter @cadencr/service build:sidecars"*"resources/bin/x64/cadencr-service"*"--linux"*"--publish never"*"scripts/smoke-linux-packages.sh"*) ;;
  *) fail "workflow must build, sidecar-smoke and package-smoke Linux on the oldest-glibc runner" ;;
esac

case "$workflow_text" in
  *"needs: [release, linux]"*"Create draft GitHub release"*) ;;
  *) fail "the draft release must be created only after both macOS and Linux builds succeed" ;;
esac

case "$workflow_text" in
  *"Upload GitHub release assets"*'Cadencr-${version}-x86_64.AppImage'*'latest-linux.yml'*"Verify uploaded GitHub release assets"*'"Cadencr-${version}-x86_64.AppImage"'*'"Cadencr-${version}-amd64.deb"'*'"Cadencr-${version}-x86_64.rpm"'*'"latest-linux.yml"'*"Publish GitHub release"*) ;;
  *) fail "workflow must upload and verify every Linux updater target and latest-linux.yml" ;;
esac

case "$workflow_text" in
  *"AppImage.blockmap"*)
    fail "electron-builder embeds the AppImage block map; never expect a separate AppImage block map file"
    ;;
esac
