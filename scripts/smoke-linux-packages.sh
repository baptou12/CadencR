#!/usr/bin/env bash
# Smoke-tests built Linux desktop packages: the AppImage payload, then a real
# install of the DEB and RPM in clean distro containers (oldest supported glibc
# included), checking the sidecar runs and electron-updater's package identity.
#
#   scripts/smoke-linux-packages.sh <dist-dir> <version> [x64|arm64]
#
# Needs docker. Runs in CI on x64 and locally (e.g. Docker Desktop on Apple
# Silicon) on arm64.
set -euo pipefail

fail() {
  echo "smoke-linux-packages: $*" >&2
  exit 1
}

[ "$#" -ge 2 ] || fail "usage: $0 <dist-dir> <version> [x64|arm64]"
dist_dir="$(cd "$1" && pwd)"
version="$2"
arch="${3:-x64}"

case "$arch" in
  x64) appimage_arch="x86_64" deb_arch="amd64" rpm_arch="x86_64" platform="linux/amd64" ;;
  arm64) appimage_arch="arm64" deb_arch="arm64" rpm_arch="aarch64" platform="linux/arm64" ;;
  *) fail "unsupported arch: $arch" ;;
esac

appimage="Cadencr-${version}-${appimage_arch}.AppImage"
deb="Cadencr-${version}-${deb_arch}.deb"
rpm="Cadencr-${version}-${rpm_arch}.rpm"
for asset in "$appimage" "$deb" "$rpm" latest-linux.yml; do
  [ -f "$dist_dir/$asset" ] || fail "missing $dist_dir/$asset"
done

# electron-updater picks the file matching the install type from this list.
for asset in "$appimage" "$deb" "$rpm"; do
  grep -Fq "url: $asset" "$dist_dir/latest-linux.yml" || fail "latest-linux.yml does not list $asset"
done

# AppImage: extract without FUSE and check the bundled sidecar.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$dist_dir/$appimage" "$work/"
docker run --rm --platform "$platform" -v "$work:/work" -w /work debian:12 bash -eu -c "
  chmod +x '$appimage'
  ./'$appimage' --appimage-extract > /dev/null
  test -x squashfs-root/resources/cadencr-service
  squashfs-root/resources/cadencr-service --help > /dev/null
  # AppImages install no package, so electron-updater must not see an identity.
  test ! -e squashfs-root/resources/package-type
"

deb_check='
  sidecar=$(dpkg -L cadencr | grep -E "/resources/cadencr-service$" | head -n1)
  package_type=$(dpkg -L cadencr | grep -E "/resources/package-type$" | head -n1)
  test -n "$sidecar" && test -x "$sidecar"
  test "$(cat "$package_type")" = deb
  "$sidecar" --help > /dev/null
  command -v git > /dev/null && command -v lsof > /dev/null
'
for image in debian:12 ubuntu:22.04 ubuntu:24.04; do
  echo "Installing $deb on $image"
  docker run --rm --platform "$platform" -v "$dist_dir:/pkg:ro" "$image" bash -eu -c "
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq /pkg/$deb > /dev/null
    $deb_check
  "
done

rpm_check='
  sidecar=$(rpm -ql cadencr | grep -E "/resources/cadencr-service$" | head -n1)
  package_type=$(rpm -ql cadencr | grep -E "/resources/package-type$" | head -n1)
  test -n "$sidecar" && test -x "$sidecar"
  test "$(cat "$package_type")" = rpm
  "$sidecar" --help > /dev/null
  command -v git > /dev/null && command -v lsof > /dev/null
'
echo "Installing $rpm on fedora:41"
docker run --rm --platform "$platform" -v "$dist_dir:/pkg:ro" fedora:41 bash -eu -c "
  dnf install -y -q /pkg/$rpm > /dev/null
  $rpm_check
"
echo "Installing $rpm on opensuse/leap:15.6"
docker run --rm --platform "$platform" -v "$dist_dir:/pkg:ro" opensuse/leap:15.6 bash -eu -c "
  zypper --non-interactive --quiet install --allow-unsigned-rpm /pkg/$rpm > /dev/null
  $rpm_check
"

echo "Linux packages passed smoke tests: $appimage, $deb, $rpm"
