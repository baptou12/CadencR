# Pi provider platform qualification — 2026-10-25

## Scope and result

The Pi connector (`external-node-pi`: the host's own Node plus a separately installed
Pi `0.85.1`, nothing bundled) was prepared for `linux-aarch64` and `linux-x86_64` in
addition to the macOS targets. The native loopback qualification first ran on the two
platforms available locally, and then on all remaining platforms through the hosted
workflow (run `40195699743`, 2026-10-25, see "Hosted run results"):

| Target           | Where it ran                                                                                      | Result                          | Evidence state in `readiness.json`                                    |
| ---------------- | ------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| `darwin-aarch64` | This Mac (Apple Silicon, macOS 27.0.1)                                                            | Passed, `2/2`, 0 skipped        | `native-loopback-qualified-local`                                     |
| `linux-aarch64`  | Debian 12 arm64 container (Docker Desktop on the same Mac); also GitHub-hosted `ubuntu-24.04-arm` | Passed, `2/2`, 0 skipped (both) | `native-loopback-qualified-container` (hosted run recorded alongside) |
| `darwin-x86_64`  | GitHub-hosted `macos-15-intel` (Intel, no Rosetta)                                                | Passed, `2/2`, 0 skipped        | `native-loopback-qualified-hosted`                                    |
| `linux-x86_64`   | GitHub-hosted `ubuntu-24.04` (x86_64)                                                             | Passed, `2/2`, 0 skipped        | `native-loopback-qualified-hosted`                                    |

This is protocol qualification against an owned `127.0.0.1` model fixture. It is **not**
managed-install qualification, real-model authentication or tool behavior, a packaged
Cadencr app check, or publication approval (`release-policy.json` `publication` stays
`PENDING`). No personal credentials, personal Pi configuration or paid model were used.
Windows is not prepared.

The package template declares `distribution.binary`, and the release policy
`payloads` name, all four prepared targets (`darwin-aarch64`, `darwin-x86_64`,
`linux-aarch64`, `linux-x86_64`). `darwin-x86_64` and `linux-x86_64` were added to
both only **after** the manually dispatched `Qualify Pi provider on native platforms`
workflow passed on their own runners (see "Hosted run results"). A container result
never stands in for hosted or bare-metal evidence, and a result on one OS never stands
in for another.

## Findings about the payload and launcher

- The payload is a JavaScript connector (`bin/provider` plus `.mjs` modules, README,
  LICENSE, icon). Nothing in `src/` branches on the platform, so it is **byte-identical
  for every target**: the canonical CLI produced the same archive for all four
  prepared targets (`26243` bytes, SHA-256 below), and the extracted payload (digests and
  modes) was identical on macOS and in the Linux container.
- `cmd: bin/provider` works on Linux: the `#!/usr/bin/env node` shebang resolves Node
  through `PATH`, the archive stores the exec bit (`0755`), and extraction by GNU tar 1.34
  and macOS bsdtar both keep it. The connector does not search for Node or for Pi itself:
  Pi is `CADENCR_PI_COMMAND` or `pi` on `PATH`, Node is whatever `PATH` provides.
- No connector change was needed. Fixes at the preparation boundary only:
  `scripts/targets.mjs` is now the single platform/arch-to-target mapping (macOS and
  Linux, arm64 and x64; anything else is refused), the preparer accepts the four prepared
  targets, and `scripts/qualify-native.mjs` refuses a run unless the Node build's
  platform/architecture equal the target. Because that is the Node _build_, it also
  refuses a Rosetta-translated macOS process (`sysctl.proc_translated`) and a Linux
  host whose `uname -m` disagrees; `--environment hosted` additionally requires
  `GITHUB_ACTIONS=true`, `RUNNER_ENVIRONMENT=github-hosted` and `RUNNER_OS`/`RUNNER_ARCH`
  for the target. These stop operator mistakes; they are not attestations (the
  variables can be set by hand, and a user-mode emulator can report its guest machine).
- Pre-existing trap fixed: `prepare-candidate.mjs` (and the new scripts) compared
  `import.meta.url` with the _unresolved_ `argv[1]`, so invoking them through a symlinked
  path (macOS `/tmp` -> `/private/tmp`) exited `0` and did nothing. Every Pi script with
  a main guard now shares `scripts/entrypoint.mjs` (`isMain`, which resolves `argv[1]`)
  and it has a regression test. `src/provider.mjs` keeps its own copy because changing
  `src/` would change the executable payload digest. Note the preparer still demands symlink-free
  absolute paths, so use `/private/tmp/...` on macOS.

## Exact identities

| Binding                              | Value                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connector / external Pi / Node       | `0.4.0` / `0.85.1` (fresh `npm install --ignore-scripts`, not a personal install) / `v22.19.0` (the repo's `.nvmrc`)                                                                                                                                                                          |
| Archive (all four targets identical) | `pi-0.4.0-<target>.tar.gz`, `26243` bytes (local snapshot; the hosted archive is `26406` bytes, see "Hosted run results")                                                                                                                                                                     |
| Archive SHA-256                      | `2e44c7bb142e7817edbd6292302257c2bc1554d4f33feb9544fa315cff6898d1`                                                                                                                                                                                                                            |
| Payload `SHA256SUMS` digest          | `3b30dfcc5daa18e228d3902182ca28a7a9c4c9d5e115d966d1a5906ddd786cde` (sorted `sha256  path` lines of the whole archive payload, both OSes)                                                                                                                                                      |
| Local CLI                            | `cadencr 0.14.2` debug build of this worktree, SHA-256 `026aee60d150aa94a7fe802adac24aed71461147ba2565be28eb80d710343f96`                                                                                                                                                                     |
| Released CLI cross-check             | Pinned released ELF `0.14.2`, SHA-256 `1a2c28a13009c303e01148fe87b54fa77936bcfbe3947c51db918cbae5477849` (`scripts/cli-qualification.env`)                                                                                                                                                    |
| Candidate metadata                   | publisher `cadencr`, `min_app_version` `0.15.0`, placeholder `https://example.invalid/...` archive URL (nothing is hosted)                                                                                                                                                                    |
| macOS host                           | Darwin `27.0.0` (macOS `27.0.1`), arm64                                                                                                                                                                                                                                                       |
| Linux host                           | Debian GNU/Linux 12 (bookworm) container, `linux/arm64`, kernel `6.12.76-linuxkit` (Docker Desktop's linuxkit VM: a real arm64 Linux kernel on Apple Silicon hardware, not CPU emulation; the hosted `ubuntu-24.04-arm` run is recorded below), GNU tar 1.34, run as uid `1000` with `--init` |
| Source identity                      | **Uncommitted working tree.** The sources were snapshotted into a throwaway Git repository (the preparer demands a clean `HEAD`); the payload is bound by the archive and `SHA256SUMS` digests above, which `source-readiness.test.mjs` recomputes from the tracked sources.                  |

The archive covers `src/`, `README.md`, `LICENSE` and `icon.svg`; the digests above are
those of the qualified snapshot and are not tracked in `readiness.json`. What
`readiness.json` binds is the **executable payload** only: the `bin/*` lines of the
packager's `SHA256SUMS` (`2a3728da...e485`, identical in both evidence files). A source
edit changes it and requires requalification (`source-readiness.test.mjs` recomputes it
with `scripts/package.mjs`); a README, LICENSE or icon edit does not, but changes the
archive bytes, so the release archive is rebuilt and carries its own digest.

## Commands

Paths use `/private/tmp/pi-plat` (macOS resolves `/tmp` through a symlink, which the
preparer rejects). `$SNAP` is the throwaway repository holding a snapshot commit of
`plugins/providers/pi`; `$CLI` is the local `cadencr` above.

```sh
# Pi 0.85.1, exactly as the README installs it but into a private prefix
npm install --prefix /private/tmp/pi-plat/pi-install-darwin --ignore-scripts \
  --no-audit --no-fund @earendil-works/pi-coding-agent@0.85.1

# One canonical archive per prepared target (loop over the four targets)
node $SNAP/plugins/providers/pi/scripts/qualification-input.mjs \
  --target <target> --output /private/tmp/pi-plat/mac/input-<target>.json
node $SNAP/plugins/providers/pi/scripts/prepare-candidate.mjs \
  --source-commit "$(git -C $SNAP rev-parse HEAD)" --candidate-target <target> \
  --runtime external-node-pi --package /private/tmp/pi-plat/mac/input-<target>.json \
  --cli $CLI --cli-sha256 026aee60d150aa94a7fe802adac24aed71461147ba2565be28eb80d710343f96 \
  --directory /private/tmp/pi-plat/mac/cand-<target>

# (a) this Mac, darwin-aarch64
node $SNAP/plugins/providers/pi/scripts/qualify-native.mjs --target darwin-aarch64 \
  --archive /private/tmp/pi-plat/mac/cand-darwin-aarch64/pi-0.4.0-darwin-aarch64.tar.gz \
  --pi /private/tmp/pi-plat/pi-install-darwin/node_modules/.bin/pi \
  --environment local --evidence /private/tmp/pi-plat/mac/evidence-darwin-aarch64.json

# (b) linux-aarch64 in the repo's Linux image (cadencr-linux-dev:arm64, Debian 12, Node 22.19.0)
docker run --rm --init --platform linux/arm64 -u 1000:1000 -e HOME=/tmp/home \
  -v /private/tmp/pi-plat/linux:/work -v $SNAP:/repo:ro cadencr-linux-dev:arm64 bash -euo pipefail -c '
    mkdir -p $HOME && cd /work && mkdir pi-install && (cd pi-install && \
      npm install --prefix . --ignore-scripts --no-audit --no-fund @earendil-works/pi-coding-agent@0.85.1)
    node /repo/plugins/providers/pi/scripts/qualify-native.mjs --target linux-aarch64 \
      --archive /work/pi-0.4.0-linux-aarch64.tar.gz --pi /work/pi-install/node_modules/.bin/pi \
      --environment container --evidence /work/evidence-linux-aarch64.json'
```

Deviation from `scripts/linux-container.sh`: the script has no "run an arbitrary command"
subcommand (`shell` is interactive and first syncs and `pnpm install`s the whole tree),
so the container was started with the same image (built by the script's `ensure_image`)
and the same safety flags (`--init`, non-root uid 1000, `--platform linux/arm64`), without
the tree sync. The loopback test needs only the archive, Pi and the plugin scripts. The
8 GB VM was not stressed: a single Node process and one fixture.

`qualify-native.mjs` extracts the archive (after rejecting absolute or `..` members),
checks that `bin/provider` is executable, `bin/provider version` is `0.4.0`, records
`pi --version` in the evidence, then runs `test/native-loopback.test.mjs` (which itself
requires Pi `0.85.1`) with only the two explicit executable paths, and writes an
evidence JSON without local paths. The result is `passed` when at least one loopback
test ran, all of them passed and none was skipped. The scratch directory is deleted
after a pass and kept (and named) after a failure.

## Results

| Check                                         | darwin-aarch64 (local)              | linux-aarch64 (container)           |
| --------------------------------------------- | ----------------------------------- | ----------------------------------- |
| Extracted `bin/provider` mode / `version`     | `0755` / `0.4.0`                    | `0755` / `0.4.0`                    |
| Native loopback suite                         | `2` passed, `0` failed, `0` skipped | `2` passed, `0` failed, `0` skipped |
| Discovery / initialize / new session          | Passed                              | Passed                              |
| Streamed text / `end_turn` / usage            | Passed                              | Passed                              |
| Durable connector restart and resumed context | Passed                              | Passed                              |
| Held-stream cancellation                      | Passed                              | Passed                              |
| Model accounting                              | Exactly `3` owned loopback requests | Exactly `3` owned loopback requests |
| Extracted payload digests and modes           | Identical to the Linux run          | Identical to the macOS run          |

Source suites (`node --test plugins/providers/pi/test/*.test.mjs`):

| Host                                   | Tests | Passed | Skipped | Failed |
| -------------------------------------- | ----- | ------ | ------- | ------ |
| macOS arm64 (`v22.19.0`)               | `105` | `103`  | `2`     | `0`    |
| Debian 12 arm64 container (`v22.19.0`) | `105` | `103`  | `2`     | `0`    |

The `2` skips are the native opt-in cases when the environment variables are absent.
With the local CLI supplied (`CADENCR_PI_CANDIDATE_TEST_CLI`), `candidate-package.test.mjs`
passes `6/6` on macOS, including real-engine packing of all four prepared targets and an
assertion that their archive bytes are identical. That real-CLI test could not run in the
arm64 container (the only released CLI is an x86_64 ELF).

### Emulated `linux-x86_64` pre-flight (informational, does not qualify)

To exercise the exact workflow shell steps before dispatch, an `ubuntu:24.04`
`linux/amd64` container (emulated on Apple Silicon) ran: fetch of the **released** CLI
`0.14.2` (checksum-verified), `prepare-candidate.mjs` for the four targets, and
`qualify-native.mjs --target linux-x86_64 --environment container`. The released ELF
produced the **same archive SHA-256** as the local CLI for every target, and the native
loopback passed `2/2`. Because the CPU was emulated, this is recorded only as workflow
validation; it was superseded by the hosted `linux-x86_64` run below.

## Hosted workflow

`.github/workflows/pi-provider-qualification.yml` is `workflow_dispatch` only, with
`permissions: contents: read`, `persist-credentials: false` and the action SHAs the other
workflows pin. One `ubuntu-24.04` job packs the four archives with the pinned released
CLI (and asserts they are byte-identical); then each matrix job runs on its own target:

| Target          | Runner             | Note                                                                                                                                                          |
| --------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `linux-x86_64`  | `ubuntu-24.04`     |                                                                                                                                                               |
| `linux-aarch64` | `ubuntu-24.04-arm` | Hosted native arm64 cross-check of the container result                                                                                                       |
| `darwin-x86_64` | `macos-15-intel`   | The Intel macOS image label GitHub documents (`macos-13` is retired); first exercised by run `40195699743`, where it did provide an Intel (X64) macOS runner. |

Each job installs Pi `0.85.1` with `--ignore-scripts`, verifies the archive digest against
the packer's receipt, runs the same `qualify-native.mjs` with `--environment hosted`, and
uploads `pi-qualification-<target>-<run>-<attempt>` (evidence JSON, 30 days). The
packed-archive handoff artifact is `pi-candidates-<run>` (no attempt number, replaced on
a full re-run) so re-running only failed qualification jobs still finds it; each job
reads the archive name and digest from the preparer's `candidate.json`. It needs no
secrets. `macos-15` (arm64) is not in the matrix because `darwin-aarch64` already passed
locally; add it if hosted evidence for that target is also wanted.

## Hosted run results

Run [`40195699743`](https://github.com/merkr-software/CadencR/actions/runs/40195699743)
(`workflow_dispatch`, attempt `1`) on `main` commit `ba3ddf239d5694e58f7c92576e913f139aa2d79c`
(2026-10-25). The `pack` job and all three `qualify` jobs succeeded. The evidence JSON
files (`pi-qualification-<target>-40195699743-1`) and the packed candidates
(`pi-candidates-40195699743`) were downloaded and read for this record.

| Target          | Runner label       | Runner (`RUNNER_ENVIRONMENT`/OS/arch) | Node host platform/arch (machine) | OS release          | Rosetta | Loopback         |
| --------------- | ------------------ | ------------------------------------- | --------------------------------- | ------------------- | ------- | ---------------- |
| `darwin-x86_64` | `macos-15-intel`   | github-hosted / macOS / X64           | `darwin` / `x64` (none reported)  | Darwin `24.6.0`     | no      | `2/2`, 0 skipped |
| `linux-x86_64`  | `ubuntu-24.04`     | github-hosted / Linux / X64           | `linux` / `x64` (`x86_64`)        | `6.17.0-1022-azure` | n/a     | `2/2`, 0 skipped |
| `linux-aarch64` | `ubuntu-24.04-arm` | github-hosted / Linux / ARM64         | `linux` / `arm64` (`aarch64`)     | `6.17.0-1022-azure` | n/a     | `2/2`, 0 skipped |

All three: Node `v22.19.0`, Pi `0.85.1`, connector `0.4.0`, `3` owned loopback
requests (discovery, initialize, new, streamed text/`end_turn`/usage, durable restart
and resume, held-stream cancellation), `uses_personal_credentials: false`,
`managed_installation: not-qualified`. The Darwin release `24.6.0` corresponds to
macOS 15; the Linux kernel string is the Azure image kernel, not a distribution name.
The evidence files do not record the Linux distribution; `ubuntu-24.04` is the runner
label. The runner fields come from the job's own environment variables (see the guards
note above), so they are not attestations.

Bindings from the hosted run (identical in all three evidence files and all four packed
`candidate.json` files):

| Binding                                        | Value                                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Archive                                        | `pi-0.4.0-<target>.tar.gz`, `26406` bytes, byte-identical for all four targets                                                               |
| Archive SHA-256                                | `c89431a61e4c2110f2e5d5bfe54d378fc231062208632533113f206205796c12` (re-hashed locally from the downloaded `pi-candidates-40195699743`)       |
| Executable payload digest (`bin/*` SHA256SUMS) | `2a3728dacebd01f1c9e8fd725ac1fb114a08e0939b0010efb8ef22e614e1e485`, recomputed from each evidence file's `payload` map                       |
| Whole-payload `SHA256SUMS` digest              | `fdf61134f3ea0701f8c67303f03f56a9048b941412567d9d92626eda3ec46b70` (sorted `sha256  path` lines of all 15 payload files, recomputed locally) |
| Payload modes                                  | `bin/provider` `755`; every other file `644`                                                                                                 |
| Source commit                                  | `ba3ddf239d5694e58f7c92576e913f139aa2d79c` (a real commit, unlike the earlier uncommitted snapshot)                                          |

The hosted executable payload digest **matches** the one recorded in `readiness.json`
(`executable_payload_sha256sums_digest`, the local macOS and Linux-container runs); the
hosted run therefore qualified the same executable bytes. The hosted archive differs
from the earlier local snapshot archive (`26406` vs `26243` bytes, SHA-256
`c89431a6...` vs `2e44c7bb...`; whole-payload digest `fdf61134...` vs `3b30dfcc...`)
only in non-executable payload files. LICENSE and icon digests are pinned in
`readiness.json` and unchanged, so the difference is inferred to be `README.md`, edited
after the local snapshot. By the rule above that does not require requalification.
The README was edited again afterwards to record these results; its new digest is
pinned in `release-policy.json`.

`readiness.json` now records `darwin-x86_64` and `linux-x86_64` as
`native-loopback-qualified-hosted` (with a `hosted_run` record), keeps
`linux-aarch64` as `native-loopback-qualified-container` and adds the hosted
`ubuntu-24.04-arm` evidence under `passed.linux-aarch64.hosted_evidence` (it replaces
`hosted_arm64_runner_evidence: pending`), and leaves `pending_hosted_run` empty.
`darwin-aarch64` remains local-only: the `macos-15` (arm64) runner was not in the
matrix. The manual-dispatch workflow also stays a candidate/qualification tool; nothing
here is publication approval, and `release-policy.json` `publication` stays `PENDING`.

### Checklist applied after the hosted run

1. `readiness.json` `targets.<target>.evidence` set to `native-loopback-qualified-hosted`
   for `darwin-x86_64` and `linux-x86_64`, both moved from `pending_hosted_run` to
   `passed` (the archive digest was identical for all four, so no requalification of the
   others was needed).
2. Both targets added to `distribution.binary` in `package-template.json` (still
   `PENDING` archive/digest placeholders) and to `release-policy.json`
   `plugins.provider-pi.payloads` (copy of the existing payload entry; the payload is
   byte-identical for every target).
3. The `...-hosted` upgrade of `linux-aarch64` was recorded as additional evidence next to
   the container evidence rather than replacing it; `darwin-aarch64` was not run hosted.

`source-readiness.test.mjs` fails if a target is declared without qualified evidence or
the policy and template disagree.

## Platform test ledger (macOS and Linux)

| Item                                                                     | macOS                                        | Linux                                                                        | How                       |
| ------------------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------- |
| Host/target mapping, Rosetta, `uname -m` and hosted-runner guards (unit) | Run (arm64)                                  | Run (arm64 container)                                                        | Automated                 |
| Source suite incl. launcher shebang/LF and symlinked-entry regression    | Run                                          | Run (container)                                                              | Automated                 |
| Extracted-archive native loopback with real Pi                           | Run, `darwin-aarch64`                        | Run, `linux-aarch64` (container)                                             | Automated script          |
| Real-CLI packing of all four targets, identical bytes                    | Run (local CLI)                              | Run on hosted `ubuntu-24.04` (pinned released CLI, byte-identical assertion) | Automated / hosted        |
| `darwin-x86_64` native run                                               | Run (hosted `macos-15-intel`, `40195699743`) | n/a                                                                          | Hosted workflow           |
| `linux-x86_64` native run                                                | n/a                                          | Run (hosted `ubuntu-24.04`, `40195699743`)                                   | Hosted workflow           |
| `linux-aarch64` hosted native run                                        | n/a                                          | Run (hosted `ubuntu-24.04-arm`, `40195699743`)                               | Hosted workflow           |
| Linux bare metal / packaged Cadencr / managed install / real-model auth  | Not run                                      | **Not run**                                                                  | Real platform or artifact |

Nothing here proves behavior of the packaged desktop app, managed installation, update or
recovery on either OS; those remain separate gates, as do publication approval and legal
review.
