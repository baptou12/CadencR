#!/bin/sh
# Trusted exact-commit CI helper for the unattended catalog renewal, the
# read-only expiry watch and the signing-key lifecycle of the reviewed
# publisher. It contains orchestration and guards only: signing, verification
# and publication are done by the pinned released Rust CLI.
#
#   gate <renewal|watch>             inert-until-configured check (no secrets)
#   fetch <dir> <catalog|all>        bounded, redirect-free public downloads
#   prepare <snapshot> <request>     build the renewal-only request (no secrets)
#   publish <request> <state>        re-assert renewal-only, then publish
#   materialize-key <prefix>         write the signing key to an owned 0700 directory
#   remove-key <prefix>              delete it again (shared with the reviewed publisher)
#   check-expiry <snapshot>          expiry + signature checks (watch)
#
# Every error is fatal. Configuration is read from CADENCR_REGISTRY_* variables.
set -eu
mode=${1:?mode is required}
FEED_PREFIX="https://raw.githubusercontent.com/"
MAX_FEED_BYTES=33554432

fail() { echo "::error::$*" >&2; exit 1; }
have() { [ -n "$(printenv "$1" || true)" ]; }

fetch_feed() { # url destination
  case "$1" in
    "$FEED_PREFIX"*) ;;
    *) fail "feed URL must start with $FEED_PREFIX" ;;
  esac
  case "$1" in
    *[!A-Za-z0-9._:/-]*) fail "feed URL contains unsupported characters (no query, fragment or credentials)" ;;
  esac
  [ ! -e "$2" ] || fail "refusing to overwrite $2"
  # No redirects, https only, bounded size and time. A transient 5xx or timeout
  # is retried; anything else (404, redirect, oversize) is terminal. Without
  # --location curl exits 0 on a 3xx, so HTTP 200 is required explicitly.
  status=$(curl --silent --show-error --fail --proto '=https' --max-redirs 0 \
    --max-filesize "$MAX_FEED_BYTES" --max-time 30 \
    --retry 3 --retry-delay 5 --retry-max-time 90 \
    -H 'Cache-Control: no-cache' --output "$2" --write-out '%{http_code}' "$1") \
    || { rm -f "$2"; fail "could not download $1"; }
  [ "$status" = 200 ] || { rm -f "$2"; fail "unexpected HTTP status $status from $1"; }
  # --max-filesize only trusts Content-Length; bound the bytes actually written.
  size=$(wc -c < "$2")
  [ "$size" -le "$MAX_FEED_BYTES" ] || { rm -f "$2"; fail "download from $1 exceeds $MAX_FEED_BYTES bytes"; }
  [ -s "$2" ] || fail "empty download from $1"
}

case "$mode" in
gate)
  purpose=${2:?gate purpose is required}
  case "$purpose" in
    renewal) required="CADENCR_REGISTRY_CATALOG_URL CADENCR_REGISTRY_KEY_ID CADENCR_REGISTRY_PUBLIC_KEY_PEM" ;;
    watch) required="CADENCR_REGISTRY_CATALOG_URL CADENCR_REGISTRY_PROVIDER_BLOCKLIST_URL CADENCR_REGISTRY_THEME_BLOCKLIST_URL CADENCR_REGISTRY_TAB_BLOCKLIST_URL CADENCR_REGISTRY_KEY_ID CADENCR_REGISTRY_PUBLIC_KEY_PEM" ;;
    *) fail "unknown gate purpose: $purpose" ;;
  esac
  if ! have CADENCR_REGISTRY_CATALOG_URL; then
    echo "::notice title=Registry $purpose is not configured::CADENCR_REGISTRY_CATALOG_URL is unset, so this job is inert. Set the repository variables listed in OPERATIONS.md to activate it."
    echo "configured=false" >> "$GITHUB_OUTPUT"
    exit 0
  fi
  # The catalog URL is the activation switch: from here on, any gap is an error.
  missing=
  for name in $required; do have "$name" || missing="$missing $name"; done
  [ -z "$missing" ] || fail "registry $purpose is partially configured; missing repository variables:$missing"
  trust=0
  for name in CADENCR_REGISTRY_TRUST_MANIFEST_JSON CADENCR_REGISTRY_ROOT_KEY_ID CADENCR_REGISTRY_ROOT_PUBLIC_KEY_PEM; do
    ! have "$name" || trust=$((trust + 1))
  done
  [ "$trust" -eq 0 ] || [ "$trust" -eq 3 ] || fail "trust manifest, root key id and root public key must be configured together"
  echo "configured=true" >> "$GITHUB_OUTPUT"
  ;;

fetch)
  dir=${2:?snapshot directory is required}
  scope=${3:?scope is required}
  mkdir -m 700 "$dir"
  fetch_feed "$CADENCR_REGISTRY_CATALOG_URL" "$dir/managed-index.json"
  case "$scope" in
    catalog) ;;
    all)
      fetch_feed "$CADENCR_REGISTRY_PROVIDER_BLOCKLIST_URL" "$dir/managed-blocklist.json"
      fetch_feed "$CADENCR_REGISTRY_THEME_BLOCKLIST_URL" "$dir/managed-theme-blocklist.json"
      fetch_feed "$CADENCR_REGISTRY_TAB_BLOCKLIST_URL" "$dir/managed-tab-blocklist.json"
      ;;
    *) fail "unknown fetch scope: $scope" ;;
  esac
  ;;

prepare)
  SNAPSHOT_DIR=${2:?snapshot directory is required}
  REQUEST_DIR=${3:?request directory is required}
  export SNAPSHOT_DIR REQUEST_DIR
  node <<'NODE'
  const { appendFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
  const { join } = require("node:path");
  const env = process.env;
  const fail = (message) => { throw new Error(message); };
  // Renew when the current baseline has at most 8 days left; the new window is
  // 13 days, one day inside the catalog's 14-day publication maximum.
  const RENEW_WITHIN_HOURS = 8 * 24;
  const WINDOW_DAYS = 13;
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

  const repository = env.GITHUB_REPOSITORY ?? fail("GITHUB_REPOSITORY is required");
  const url = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/refs\/heads\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/managed-index\.json$/
    .exec(env.CADENCR_REGISTRY_CATALOG_URL ?? "");
  if (!url) fail("CADENCR_REGISTRY_CATALOG_URL must be this repository's raw refs/heads/<branch>/managed-index.json");
  if (url[1].toLowerCase() !== repository.toLowerCase()) fail("catalog URL names a different repository");
  const branch = url[2];

  const file = join(env.SNAPSHOT_DIR, "managed-index.json");
  const metadata = lstatSync(file);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > 32 * 1024 * 1024) {
    fail("downloaded catalog must be a bounded regular file");
  }
  const baseline = readFileSync(file);
  // Timestamps and schema only schedule the renewal. The released CLI
  // authenticates this exact file against the pinned public key before signing.
  const signed = JSON.parse(baseline.toString("utf8"))?.signed;
  if (!signed || typeof signed !== "object") fail("downloaded catalog has no signed payload");
  const schema = signed.schema_version;
  if (schema !== 1 && schema !== 2) fail("downloaded catalog has an unsupported schema version");
  if ((schema === 2) !== (branch === "marketplace-v2")) fail("catalog schema does not match its discovery branch");
  if (![signed.generated_at, signed.expires_at].every((v) => timestamp.test(v ?? ""))) {
    fail("downloaded catalog has non-canonical timestamps");
  }
  const now = Math.floor(Date.now() / 1000) * 1000;
  const remaining = (Date.parse(signed.expires_at) - now) / 3600000;
  if (remaining > RENEW_WITHIN_HOURS) {
    console.log(`::notice title=Catalog renewal not needed::${remaining.toFixed(1)} hours of validity remain (renewal starts at ${RENEW_WITHIN_HOURS}).`);
    appendFileSync(env.GITHUB_OUTPUT, "needed=false\n");
    process.exit(0);
  }
  if (now <= Date.parse(signed.generated_at)) fail("current catalog generation is not older than now; refusing");

  mkdirSync(env.REQUEST_DIR, { recursive: false, mode: 0o700 });
  const put = (name, content) => writeFileSync(join(env.REQUEST_DIR, name), content, { flag: "wx", mode: 0o600 });
  const pem = (value) => (value.endsWith("\n") ? value : value + "\n");
  put("previous-index.json", baseline);
  put("public.pem", pem(env.CADENCR_REGISTRY_PUBLIC_KEY_PEM));
  const request = {
    schema_version: schema,
    repository,
    key_id: env.CADENCR_REGISTRY_KEY_ID,
    discovery_branch: branch,
    generated_at: iso(now),
    expires_at: iso(now + WINDOW_DAYS * 24 * 3600 * 1000),
    previous_index: "previous-index.json",
    public_key: "public.pem",
  };
  if (env.CADENCR_REGISTRY_TRUST_MANIFEST_JSON) {
    const manifest = env.CADENCR_REGISTRY_TRUST_MANIFEST_JSON;
    if (Buffer.byteLength(manifest) > 64 * 1024) fail("trust manifest exceeds 64 KiB");
    JSON.parse(manifest);
    const minimum = Number(env.CADENCR_REGISTRY_TRUST_MIN_GENERATION || "1");
    if (!Number.isSafeInteger(minimum) || minimum < 1) fail("trust minimum generation must be a positive integer");
    put("trust-manifest.json", manifest);
    put("root-public.pem", pem(env.CADENCR_REGISTRY_ROOT_PUBLIC_KEY_PEM));
    request.trust = {
      manifest: "trust-manifest.json",
      root_public_key: "root-public.pem",
      root_key_id: env.CADENCR_REGISTRY_ROOT_KEY_ID,
      minimum_generation: minimum,
    };
  }
  // The renewal-only marker: no package, no submission, no mirror, no upgrade.
  request.publications = [];
  put("publication-request.json", JSON.stringify(request, null, 2) + "\n");
  console.log(`Renewal request: ${request.generated_at} to ${request.expires_at}, baseline had ${remaining.toFixed(1)} hours left.`);
  appendFileSync(env.GITHUB_OUTPUT, "needed=true\n");
NODE
  ;;

publish)
  REQUEST_DIR=${2:?request directory is required}
  STATE_DIR=${3:?state directory is required}
  export REQUEST_DIR STATE_DIR
  node <<'NODE'
  const { spawnSync } = require("node:child_process");
  const { createHash } = require("node:crypto");
  const { lstatSync, mkdirSync, readFileSync, readdirSync } = require("node:fs");
  const { join } = require("node:path");
  const env = process.env;
  const fail = (message) => { throw new Error(`renewal-only guard: ${message}`); };

  // Fail closed unless the request can only re-sign the authenticated baseline.
  function renewalOnlyDigest(directory) {
    const allowed = new Set([
      "publication-request.json", "previous-index.json", "public.pem",
      "trust-manifest.json", "root-public.pem",
    ]);
    for (const name of readdirSync(directory)) {
      if (!allowed.has(name)) fail(`unexpected input ${JSON.stringify(name)}`);
      const metadata = lstatSync(join(directory, name));
      if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > 32 * 1024 * 1024) {
        fail(`${name} must be a bounded regular file`);
      }
    }
    const bytes = readFileSync(join(directory, "publication-request.json"));
    if (bytes.length > 1024 * 1024) fail("request exceeds 1 MiB");
    const request = JSON.parse(bytes.toString("utf8"));
    const base = ["schema_version", "repository", "key_id", "discovery_branch", "generated_at",
      "expires_at", "previous_index", "public_key", "publications"];
    const keys = Object.keys(request).filter((key) => key !== "trust").sort();
    if (JSON.stringify(keys) !== JSON.stringify([...base].sort())) fail("unexpected or missing request fields");
    if (!Array.isArray(request.publications) || request.publications.length !== 0) fail("publications must be empty");
    if (request.previous_index !== "previous-index.json" || request.public_key !== "public.pem") fail("baseline inputs are fixed");
    if (request.repository !== env.GITHUB_REPOSITORY) fail("request names a different repository");
    const window = Date.parse(request.expires_at) - Date.parse(request.generated_at);
    if (!(window > 0 && window <= 14 * 24 * 3600 * 1000)) fail("validity window is outside 14 days");
    if (request.trust !== undefined) {
      const trust = request.trust;
      if (JSON.stringify(Object.keys(trust).sort()) !== JSON.stringify(["manifest", "minimum_generation", "root_key_id", "root_public_key"])
        || trust.manifest !== "trust-manifest.json" || trust.root_public_key !== "root-public.pem") fail("trust inputs are fixed");
    } else if (readdirSync(directory).some((name) => name === "trust-manifest.json" || name === "root-public.pem")) {
      fail("trust files without a trust object");
    }
    return createHash("sha256").update(bytes).digest("hex");
  }

  const digest = renewalOnlyDigest(env.REQUEST_DIR);
  for (const name of ["VERIFIED_CLI", "PRIVATE_KEY_FILE", "GITHUB_SHA"]) if (!env[name]) fail(`${name} is required`);
  mkdirSync(env.STATE_DIR, { recursive: false, mode: 0o700 });
  // The CLI re-hashes the request bytes and refuses any change after this guard.
  const result = spawnSync(env.VERIFIED_CLI, ["registry", "publish-registry",
    "--request", join(env.REQUEST_DIR, "publication-request.json"),
    "--directory", env.STATE_DIR,
    "--repository", env.GITHUB_REPOSITORY,
    "--registry-commit", env.GITHUB_SHA,
    "--private-key", env.PRIVATE_KEY_FILE,
    "--confirm-request-sha256", digest,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("registry renewal failed");
NODE
  ;;

materialize-key)
  # The directory prefix names the workflow that owns the key (for example
  # marketplace-publisher-secret- or marketplace-renewal-secret-).
  KEY_PREFIX=${2:?key directory prefix is required}
  export KEY_PREFIX
  node <<'NODE'
  const { appendFileSync, chmodSync, mkdtempSync, writeFileSync } = require("node:fs");
  const { join } = require("node:path");
  if (!/^marketplace-[a-z]+-secret-$/.test(process.env.KEY_PREFIX)) throw new Error("unsupported private-key directory prefix");
  const key = process.env.CADENCR_REGISTRY_PRIVATE_KEY_PEM;
  if (!key) throw new Error("CADENCR_REGISTRY_PRIVATE_KEY_PEM is required");
  if (Buffer.byteLength(key, "utf8") > 16 * 1024) throw new Error("CADENCR_REGISTRY_PRIVATE_KEY_PEM exceeds 16 KiB");
  const directory = mkdtempSync(join(process.env.PRIVATE_KEY_ROOT, process.env.KEY_PREFIX));
  chmodSync(directory, 0o700);
  const file = join(directory, "private.pem");
  appendFileSync(process.env.GITHUB_OUTPUT, `private_key_file=${file}\n`);
  writeFileSync(file, key, { flag: "wx", mode: 0o600 });
NODE
  ;;

remove-key)
  KEY_PREFIX=${2:?key directory prefix is required}
  export KEY_PREFIX
  node <<'NODE'
  const { lstatSync, unlinkSync } = require("node:fs");
  const { dirname, relative, resolve, sep } = require("node:path");
  if (!/^marketplace-[a-z]+-secret-$/.test(process.env.KEY_PREFIX)) throw new Error("unsupported private-key directory prefix");
  const root = resolve(process.env.PRIVATE_KEY_ROOT);
  const file = resolve(process.env.PRIVATE_KEY_FILE);
  const owned = relative(root, file).split(sep);
  if (owned.length !== 2 || !new RegExp(`^${process.env.KEY_PREFIX}[^/]+$`).test(owned[0]) || owned[1] !== "private.pem") {
    throw new Error("refusing to clean a private-key path outside the owned directory");
  }
  try {
    const directoryMetadata = lstatSync(dirname(file));
    if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()) {
      throw new Error("refusing to clean through an unexpected private-key directory");
    }
    const metadata = lstatSync(file);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("refusing to clean an unexpected private-key path");
    unlinkSync(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
NODE
  ;;

check-expiry)
  dir=${2:?snapshot directory is required}
  : "${VERIFIED_CLI:?VERIFIED_CLI is required}"
  : "${KEY_DIR:?KEY_DIR is required}"
  status=0
  # Public key from a repository variable; downloaded bytes are only ever data.
  umask 077
  mkdir "$KEY_DIR"
  printf '%s\n' "$CADENCR_REGISTRY_PUBLIC_KEY_PEM" > "$KEY_DIR/public.pem"
  # Timestamp diagnostic: exit 1 at or below 72 hours, when expired or malformed.
  for name in managed-index.json managed-blocklist.json managed-theme-blocklist.json managed-tab-blocklist.json; do
    echo "== expiry: $name"
    "$VERIFIED_CLI" registry check-metadata-expiry --warning-hours 72 "$dir/$name" \
      || { echo "::error title=Registry metadata needs renewal::$name expires within 72 hours, is expired, or is unreadable"; status=1; }
  done
  # The timestamp diagnostic is unauthenticated, so also verify signatures where
  # the released CLI offers a verifier (the provider policy has none yet).
  for pair in verify-index:managed-index.json verify-theme-blocklist:managed-theme-blocklist.json verify-tab-blocklist:managed-tab-blocklist.json; do
    command=${pair%%:*}; name=${pair#*:}
    echo "== signature: $name"
    "$VERIFIED_CLI" registry "$command" --index "$dir/$name" --public-key "$KEY_DIR/public.pem" \
      --key-id "$CADENCR_REGISTRY_KEY_ID" \
      || { echo "::error title=Registry signature check failed::$name did not verify with the pinned key"; status=1; }
  done
  exit "$status"
  ;;

*) fail "unknown mode: $mode" ;;
esac
