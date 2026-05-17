#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: scripts/release.sh vX.Y.Z" >&2
}

fail() {
  echo "release: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

run() {
  echo "+ $*" >&2
  "$@"
}

version_files() {
  cat <<'FILES'
packages/claude-agent-sdk-rs/package.json
packages/opencode-sdk-rs/package.json
packages/service/package.json
packages/desktop/package.json
packages/landing/package.json
packages/claude-agent-sdk-rs/Cargo.toml
packages/cli-discovery/Cargo.toml
packages/codex-app-server-sdk-rs/Cargo.toml
packages/opencode-sdk-rs/Cargo.toml
packages/service/Cargo.toml
FILES
}

assert_clean_worktree() {
  if [ -n "$(git status --porcelain)" ]; then
    git status --short >&2
    fail "worktree must be clean before creating a release tag"
  fi
}

latest_release_tag() {
  git tag --list 'v[0-9]*' --sort=-v:refname | head -n 1
}

assert_tag_available() {
  local tag="$1"
  local repo="$2"

  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    fail "local tag already exists: $tag"
  fi

  if [ -n "$(git ls-remote --tags origin "refs/tags/$tag")" ]; then
    fail "remote tag already exists on origin: $tag"
  fi

  if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
    fail "GitHub release already exists: $tag"
  fi
}

assert_changelog_ready() {
  local tag="$1"
  [ -f CHANGELOG.md ] || fail "CHANGELOG.md is missing"
  grep -Eq "^##[[:space:]]+(\\[$tag\\]|$tag)($|[[:space:]-])" CHANGELOG.md \
    || fail "CHANGELOG.md must contain a section for $tag"
}

assert_landing_news_ready() {
  local tag="$1"
  local version="$2"
  local news_dir="packages/landing/src/content/news"

  [ -d "$news_dir" ] || fail "landing news directory is missing: $news_dir"
  grep -R -E "($tag|$version)" "$news_dir"/*.mdx >/dev/null 2>&1 \
    || fail "landing news must contain a release article mentioning $tag or $version"
}

assert_versions_ready() {
  local version="$1"
  local file

  while IFS= read -r file; do
    [ -f "$file" ] || fail "expected version file is missing: $file"
    case "$file" in
      *.json)
        grep -Eq '"version"[[:space:]]*:[[:space:]]*"'"$version"'"' "$file" \
          || fail "$file does not contain version $version"
        ;;
      *.toml)
        grep -Eq '^version[[:space:]]*=[[:space:]]*"'"$version"'"' "$file" \
          || fail "$file does not contain package version $version"
        ;;
      *)
        fail "unsupported version file type: $file"
        ;;
    esac
  done < <(version_files)
}

run_trufflehog() {
  local previous_hash="$1"
  echo "Running trufflehog from previous release commit $previous_hash" >&2
  run trufflehog git "file://$(pwd)" --since-commit "$previous_hash" --fail
}

create_release_tag() {
  local tag="$1"
  local previous_tag="$2"
  local previous_hash="$3"

  run git tag -a "$tag" -m "Release $tag" -m "Previous release: $previous_tag ($previous_hash)"
}

main() {
  [ "$#" -eq 1 ] || { usage; exit 2; }
  local tag="$1"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "tag must match vX.Y.Z: $tag"
  local version="${tag#v}"

  require_cmd git
  require_cmd gh
  require_cmd trufflehog

  local repo_root
  repo_root="$(git rev-parse --show-toplevel)"
  cd "$repo_root"

  assert_clean_worktree
  run git fetch --tags origin

  local previous_tag
  previous_tag="$(latest_release_tag)"
  [ -n "$previous_tag" ] || fail "no previous release tag found"
  [ "$previous_tag" != "$tag" ] || fail "requested tag is already the latest local release tag"

  local previous_hash
  previous_hash="$(git rev-list -n 1 "$previous_tag")"
  local repo
  repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"

  assert_tag_available "$tag" "$repo"
  assert_changelog_ready "$tag"
  assert_landing_news_ready "$tag" "$version"
  assert_versions_ready "$version"
  run_trufflehog "$previous_hash"
  create_release_tag "$tag" "$previous_tag" "$previous_hash"

  cat <<SUMMARY
Release preflight passed.
Previous release: $previous_tag
Previous commit:  $previous_hash
Created local tag: $tag

Next irreversible step for the agent:
  git push origin $tag

After pushing, do not reuse $tag if the tag or release must be deleted.
Increment the version and create a new tag instead.
SUMMARY
}

main "$@"
