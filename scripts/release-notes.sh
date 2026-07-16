#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: scripts/release-notes.sh vX.Y.Z [output-file]" >&2
}

fail() {
  echo "release-notes: $*" >&2
  exit 1
}

validate_output() {
  local output="$1"
  if [ -e "$output" ] && [ "$output" -ef CHANGELOG.md ]; then
    fail "refusing to overwrite source CHANGELOG.md; choose a different output file"
  fi
}

extract_release_notes() {
  local tag="$1"
  local output="$2"
  local tmp
  tmp="$(mktemp)"

  awk -v tag="$tag" '
    function is_target(line) {
      return line ~ "^##[[:space:]]+(\\[" tag "\\]|" tag ")($|[[:space:]-])"
    }
    function is_release_header(line) {
      return line ~ "^##[[:space:]]+"
    }
    is_target($0) {
      capture = 1
      found = 1
      print
      next
    }
    capture && is_release_header($0) {
      exit
    }
    capture {
      print
    }
    END {
      if (!found) {
        exit 10
      }
    }
  ' CHANGELOG.md > "$tmp" || {
    rm -f "$tmp"
    fail "CHANGELOG.md does not contain a section for $tag"
  }

  if ! tail -n +2 "$tmp" | grep -Eq '[^[:space:]]'; then
    rm -f "$tmp"
    fail "CHANGELOG.md section for $tag has no release note body"
  fi

  mv "$tmp" "$output"
}

main() {
  [ "$#" -eq 1 ] || [ "$#" -eq 2 ] || { usage; exit 2; }
  local tag="$1"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "tag must match vX.Y.Z: $tag"
  [ -f CHANGELOG.md ] || fail "CHANGELOG.md is missing"

  if [ "$#" -eq 2 ]; then
    validate_output "$2"
    extract_release_notes "$tag" "$2"
  else
    local tmp
    tmp="$(mktemp)"
    extract_release_notes "$tag" "$tmp"
    cat "$tmp"
    rm -f "$tmp"
  fi
}

main "$@"
