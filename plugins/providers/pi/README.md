# Cadencr provider: Pi

This monorepo-owned connector runs [Pi](https://pi.dev/) directly in native
[`--mode rpc`](https://github.com/badlogic/pi-mono/blob/v0.85.1/packages/coding-agent/docs/rpc.md) and presents an ACP v1 agent to
Cadencr. It does **not** use or require `pi-acp`.

Source lives in `plugins/providers/pi/` in the Cadencr monorepo. It remains an
external connector behind the provider-neutral installation and conformance
boundary, not a built-in adapter or a bundled desktop provider. This source
import does not publish, sign, install, or certify a provider package.

Imported from the sibling connector repository at commit `95bb90c`, preserving
candidate version `0.4.1`. `LICENSE` is retained unchanged. The imported Pi-derived icon has been replaced
with original neutral connector artwork; see [Connector artwork](#connector-artwork).
Runtime, managed-install and exact-release-candidate qualification remain separate gates.

The import adapts documentation and package scripts for the monorepo. Runtime
hardening beyond that baseline adds a stdin-`EPIPE` guard so fast native-child
exits surface ACP errors instead of crashing the connector, plus shutdown
tracking that closes sessions created after ACP input ends and waits for their
cleanup, preserving cleanup failures in shutdown rejection as well as ACP errors.
Dedicated fake regressions cover these cases. Fake-test results do not
certify compatibility with real upstream Pi or the packaged Cadencr host.

## Prerequisites

- Node.js `>=22.19.0 <23.0.0` (the supported runtime range).
  The minimum matches the pinned Pi `0.85.1` [upstream runtime requirement](https://github.com/badlogic/pi-mono/blob/v0.85.1/packages/coding-agent/package.json).
- `pi` available on `PATH`:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.85.1
```

Run `pi` once and configure at least one model provider. Credentials remain
owned by Pi; this connector does not directly access Pi credential storage.
Native Pi diagnostics forwarded through errors or stderr can contain sensitive
information. Review and redact diagnostics before sharing them publicly.

## Build and validate

Run these commands from the monorepo root. The connector has no runtime package
dependencies, and its dedicated scripts are excluded from generic app tasks:

```bash
pnpm install --frozen-lockfile
pnpm --filter @cadencr/pi-provider build:plugin
pnpm --filter @cadencr/pi-provider test:plugin

./plugins/providers/pi/bin/provider version
```

Optional smoke starts real Pi without sending prompts; do not run it as part of
fake-only validation:

```bash
pnpm --filter @cadencr/pi-provider smoke
./plugins/providers/pi/bin/provider models --format acp-config-options-v1 --cwd "$PWD"
```

Optional live QA commands exercise real configured models. The first performs
text and tool turns in a newly created scratch workspace, permits only the exact
`printf PI_RPC_TOOL_OK` bash command, and retains all scratch files; the second restarts the connector between two turns and
proves Pi retained the conversation through ACP `session/resume`:

```bash
CADENCR_PI_LIVE_QA=1 pnpm --filter @cadencr/pi-provider live-qa
CADENCR_PI_LIVE_QA=1 pnpm --filter @cadencr/pi-provider resume-qa
```

Explicit formatting and lint checks are also available from the root:

```bash
pnpm --filter @cadencr/pi-provider format:plugin:check
pnpm --filter @cadencr/pi-provider lint:plugin
```

The build copies every runtime module and the permission extension into the
stable, ignored `bin/` directory. `bin/provider` is marked executable.

## Executable contract

| Cadencr command                                   | Native implementation                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version`                                         | Prints the connector version.                                                                                                                    |
| `models --format acp-config-options-v1 --cwd ...` | Starts an ephemeral `pi --mode rpc --no-session --no-approve`, requests `get_available_models` and `get_state`, and emits an ACP model selector. |
| `run --protocol acp-v1`                           | Runs this connector's ACP v1 JSON-RPC server. Each ACP session owns a persistent `pi --mode rpc` child in the requested workspace.               |

Set `CADENCR_PI_COMMAND` when `pi` is not on `PATH`.

Extra descriptor arguments after Cadencr's reserved arguments are forwarded as
a direct Pi argument vector. No shell interpolation is used.

## Feature mapping

The statuses below describe implemented mappings and fake-fixture coverage, not
live compatibility certification or packaged-host conformance.

| Cadencr / ACP feature       | Pi RPC mapping                                                             | Status                                                                                             |
| --------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Pre-session model selection | `get_available_models` + `get_state`                                       | Full; provider/model IDs match the live selector exactly.                                          |
| Model metadata              | Native name, context window, image input, reasoning levels                 | Full for metadata Pi exposes.                                                                      |
| Live model changes          | `set_model` followed by authoritative state/config refresh                 | Full.                                                                                              |
| Thinking level              | `get_available_thinking_levels` + `set_thinking_level`                     | Full, including `xhigh` and `max` where the model advertises them.                                 |
| Text streaming              | `message_update.text_delta` → `agent_message_chunk`                        | Full.                                                                                              |
| Thinking streaming          | `message_update.thinking_delta` → `agent_thought_chunk`                    | Full.                                                                                              |
| Images                      | ACP image blocks → Pi RPC image content                                    | Supported when the selected Pi model accepts images.                                               |
| Tool lifecycle              | `tool_execution_start/update/end` → ACP tool call updates                  | Full, including streaming output and raw input/output.                                             |
| Tool permission             | Bundled Pi extension → RPC extension UI → ACP `session/request_permission` | Mutating/custom tools prompt; `read`, `grep`, `find`, and `ls` remain read-only and do not prompt. |
| Cancellation                | ACP `session/cancel` → Pi `abort`                                          | Full; the prompt answers `stopReason: cancelled`.                                                  |
| Durable resume              | Workspace-bound ACP ID → a new `pi --mode rpc --session-id <native-id>`    | Full through stable `session/resume`; legacy `session/load` remains accepted for older hosts.      |
| Graceful close              | `session/close` → Pi abort (when active) → process teardown                | Full; active work is cancelled before the connector releases the native process.                   |
| Slash commands              | `get_commands` → `available_commands_update`                               | Full for commands Pi exposes in RPC mode.                                                          |
| Usage/context/cost          | `get_session_stats` → ACP `usage_update`                                   | Full for Pi's cumulative session stats.                                                            |
| Auto compaction             | `set_auto_compaction` and compaction boundary events                       | Supported.                                                                                         |
| Queue behavior              | `set_steering_mode` / `set_follow_up_mode`                                 | Exposed as live session options.                                                                   |
| Pi session title            | RPC session info and extension title events                                | Forwarded as ACP session info.                                                                     |
| Errors                      | RPC command/model/extension failures → JSON-RPC errors                     | Surfaced to Cadencr and `stderr`; never silently swallowed.                                        |

## Deliberate limitations

- Pi RPC does not expose dynamic registration for ACP's `mcpServers`, so the
  connector reports that limitation on `stderr` and lets Pi use its own
  extension-provided integrations.
- Pi extension `input` and `editor` dialogs need free-form elicitation, which
  stable ACP v1 does not provide. They are cancelled explicitly. `confirm` and
  `select` dialogs are bridged through ACP permission choices.
- Pi RPC exposes no native plan event. The connector does not infer a plan from
  prose or tool calls.
- Pi executes tools locally. ACP filesystem/terminal delegation is not involved;
  the connector streams Pi's real tool lifecycle back to Cadencr instead.
- Pi RPC has no session-file deletion command, so the connector deliberately
  does not advertise or implement ACP `session/delete`. Pi's own session storage
  remains the source of truth and can be managed with Pi itself.
- Connector versions before `0.3.0` exposed raw Pi session IDs. Those IDs are
  intentionally refused because they cannot prove which workspace owns them;
  start a new conversation once to receive a workspace-bound session ID.

## Test through Cadencr's generic provider path

1. Run `pnpm --filter @cadencr/pi-provider build:plugin` from the monorepo root.
2. Package the resulting `bin/` connector, `icon.svg`, and provider metadata
   using Cadencr's provider-package contract.
3. Install that package through Cadencr's managed-provider API using a trusted
   development index. Do not point a descriptor at either repository's source
   files.
4. Fully restart the **development** Cadencr process when connector registration
   or descriptor data changed. Cadencr intentionally does not hot-reload provider
   registrations.
5. Select **Pi** and choose a model before sending the first message.
6. Exercise text, thinking, a read tool, a bash/write permission, cancellation,
   resume, close, model changes, and the session options.

This directory is connector-owned source. Its release artifact must pass the
same signature, integrity, platform, conformance, quarantine, and process-policy
checks as any other marketplace provider. End users never edit or clone Cadencr.

## Candidate packaging and platform expectations

This is a candidate scaffold, not a published or signed registry artifact.
`pnpm --filter @cadencr/pi-provider package:plugin` produces a deterministic payload directory and SHA-256 manifest
containing `bin/`, `README.md`, `LICENSE`, and `icon.svg` only. Archive/signature
and registry submission remain separate steps.

The launcher requires Node on PATH and a separately installed Pi CLI. The audited
Pi version is `0.85.1`; fixture tests do not establish live upstream compatibility.
Do not advertise a platform until its extracted payload passes host conformance.
The `#!/usr/bin/env node` launcher is POSIX-portable (macOS and Linux); Windows
requires a separately verified launcher. No runtime dependencies or credentials are bundled.

`pnpm --filter @cadencr/pi-provider smoke` starts real Pi for prompt-free discovery/session checks. Live and
resume QA additionally send billable prompts and require explicit opt-in.

The candidate pins Pi `0.85.1` because its installed protocol sources were
reviewed. Extracted-payload checks exercised actual Pi against an isolated loopback
model (and, historically on macOS arm64, the local-descriptor generic host). They
qualify that recorded protocol scope on the recorded OS and architecture only, not
managed installation, external-model authentication or every feature in the mapping. JSONL frames are limited to 16 MiB of UTF-8
bytes per frame, accommodating substantial base64 image inputs while bounding
unterminated input. Larger image frames must be resized or rejected.

Packaging refuses an existing payload directory, including symlinks. Use
`pnpm --filter @cadencr/pi-provider package:plugin --directory /absolute/new/payload` for a fresh target. The sorted
manifest is written beside it as `payload.SHA256SUMS`. No existing payload is
removed or replaced.

## Source-bound portable candidate preparation

The optional local adapter below delegates validation and both archive builds to
`cadencr registry pack-provider` (the shared Rust engine). It does not implement
another archive writer, sign, publish, approve artwork/licenses, or qualify a
platform. The official Pi release workflow still refuses publication.

```sh
node plugins/providers/pi/scripts/prepare-candidate.mjs \
  --source-commit <full-clean-HEAD-commit> \
  --candidate-target darwin-aarch64 \
  --runtime external-node-pi \
  --package /absolute/operator-supplied-candidate.json \
  --cli /absolute/reviewed/cadencr \
  --cli-sha256 <exact-reviewed-binary-sha256> \
  --directory /absolute/existing-parent/new-candidate
```

- Every option is required. Only an explicit `darwin-aarch64`, `darwin-x86_64`,
  `linux-aarch64` or `linux-x86_64` **candidate** target is accepted; preparation
  itself qualifies none of them (see `scripts/qualify-native.mjs` and the evidence
  table above). Windows is not prepared.
- `external-node-pi` preserves the current launcher, Node range and separately
  installed Pi `0.85.1` prerequisites; it does not select or approve a future
  native/self-contained distribution policy.
- Source must be the exact clean `HEAD`, with no untracked plugin source or
  tracked symlinks. Metadata is bounded to 64 KiB before reading; CLI/archive
  reads are bounded to 128 MiB through checked, non-following file descriptors.
  Runtime modules/assets are snapshotted from those Git objects,
  not shared `bin/` output. Input paths and output ancestors must be symlink-free.
- The supplied legacy provider package object has exactly `agent` and `host`.
  `agent` must use `id: "pi"`, `name: "Pi"`, version `0.4.1`, this package's exact
  description, repository `https://github.com/merkr-software/CadencR`, license
  `Apache-2.0`, and only the selected `distribution.binary` target. That target
  has only `archive`, `cmd: "bin/provider"`, and an initial 64-zero `sha256`.
  `archive` is an operator-supplied credential-free HTTPS URL ending in
  `/pi-0.4.1-<candidate-target>.tar.gz`; no URL/query credentials are accepted.
- `host` supplies the operator's candidate `publisher`, explicit compatibility
  versions, and `assets: {"icon":"icon.svg","readme":"README.md","license":"LICENSE"}`.
  No publisher, minimum app version or public hosting destination is invented.
  These candidate inputs do not constitute production approval. Additional
  fields, command arguments, environment values and multiple targets are refused;
  canonical schema validation remains owned by the Rust CLI. Input must be exact
  `JSON.stringify(value, null, 2)` bytes plus one newline, refusing ambiguous
  duplicate-key or alternate-format documents before invoking the CLI.

The receipt rechecks its Node range against committed `package.json` and its Pi
pin against the committed README install command and pinned upstream documentation.
A prerequisite change requires explicit candidate-contract review; it cannot
silently retain an obsolete runtime claim.

The new directory retains the payload snapshot, private preparation inputs,
`package.json` with the computed archive digest, two byte-identical canonical
archives, and `candidate.json`. The receipt binds source commit/path, version,
explicit candidate target, runtime prerequisites, CLI checksum, metadata checksum,
and archive digest/size, plus the committed `readiness.json` digest and its
source-license/artwork/runtime/target facts. Its publication and current-candidate
qualification gates remain `PENDING`; historical protocol evidence is not erased
or transferred to new archive bytes.
The repository namespace is expected provenance, not verified remote authority;
the receipt explicitly records `unverified-local-checkout`. It contains no runner paths. No whole-directory upload is intended: inspect only
`candidate.json`, `package.json` and the primary archive; retain private scratch
locally. Existing outputs are refused, never removed or replaced. Failures retain
partial preparation for private inspection and grant no publication authority.
Scratch is deliberately not recursively cleaned: a CLI might create an unexpected
database, and database deletion is prohibited. Errors identify the failed preparation stage and a safe validation/I/O reason or
child exit status, without forwarding arbitrary child stderr, paths or environment.

Focused real-engine tests require an explicit locally reviewed CLI:

```sh
CADENCR_PI_CANDIDATE_TEST_CLI=/absolute/reviewed/cadencr \
  node --test plugins/providers/pi/test/candidate-package.test.mjs
```

Without that variable, credential-free refusal tests still run; real canonical
archive cases are explicitly skipped. These packaging tests do not execute Pi,
access credentials, qualify macOS behavior, or replace managed-host live QA.

## Native protocol QA with a local model fixture

The opt-in test below executes the supplied connector and actual Pi `0.85.1`
against a scripted HTTP model bound to `127.0.0.1`. It checks text streaming,
usage, context retained after connector restart/resume, and held-stream
cancellation. It does not contact a real model provider or use personal Pi auth.

```sh
CADENCR_PI_NATIVE_TEST_COMMAND=/absolute/reviewed/pi \
CADENCR_PI_NATIVE_TEST_PROVIDER=/absolute/extracted/bin/provider \
  node --test plugins/providers/pi/test/native-loopback.test.mjs
```

Both executable paths must be explicit and absolute. Without either variable the
native case is skipped; partial opt-in or invalid executables fail. The test
uses an allowlisted child environment, isolated configuration/workspace/session
storage, and inert local model metadata. It retains scratch, never recursively
deletes unexpected database state, and stops its owned children and fixture.
The fixture's unit tests run normally without Pi, credentials or external APIs.

This is protocol evidence, not external-model authentication, tool-permission,
managed installation, x86_64, or publication approval. See the
[native and generic-service evidence](../../../docs/qa/MARKETPLACE_PI_LOOPBACK_2026_10_18.md).

## Connector artwork

`icon.svg` was created during AI-assisted Cadencr source maintenance on
2026-10-23 as a neutral connector/network symbol: a 64-unit rounded background,
one orthogonal branching line and three circular nodes. It was constructed from
these basic local SVG primitives, not traced from the imported Pi paths. No
upstream Pi artwork is included in the replacement. The asset is licensed under
this connector’s Apache-2.0 `LICENSE`; its SVG carries an SPDX notice.

The replacement contains no upstream Pi logo and does not imply upstream
endorsement. The imported logo was removed rather than inferring artwork
permission from the connector’s code license.

## Source review and package inputs

[`readiness.json`](readiness.json) records exact retained-source asset digests,
external runtime requirements and per-target evidence boundaries. Preparation
verifies those digests and prerequisites against committed Git blobs. It is a
review aid, not an approval or a replacement for canonical CLI validation.

| Item         | Reviewed source fact                                                                        | Boundary                                                                |
| ------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Connector    | Package and retained `LICENSE` declare Apache-2.0; runtime has no npm dependencies          | License-file presence is not an authorship/legal attestation            |
| Artwork      | Original `icon.svg` uses a rounded rectangle, orthogonal connector and three circular nodes | Created during source maintenance; Apache-2.0; not upstream Pi branding |
| Runtime      | External Node.js `>=22.19.0 <23.0.0` and Pi `0.85.1`                                        | Neither runtime, credentials nor model access is bundled                |
| macOS arm64  | Native loopback qualified on a real Apple Silicon Mac (extracted archive, actual Pi)        | Declared in the template; managed admission remains separate            |
| Linux arm64  | Native loopback qualified in an arm64 container and on a hosted arm64 runner (actual Pi)    | Declared in the template; not a bare-metal or packaged-app check        |
| macOS x86_64 | Native loopback qualified on a hosted Intel macOS runner (actual Pi)                        | Declared in the template; managed admission remains separate            |
| Linux x86_64 | Native loopback qualified on a hosted x86_64 Linux runner (actual Pi)                       | Declared in the template; managed admission remains separate            |
| Windows      | Not prepared                                                                                | Needs a verified launcher                                               |

Evidence, exact commands and digests are in
[`docs/qa/MARKETPLACE_PI_PLATFORMS_2026_10_25.md`](../../../docs/qa/MARKETPLACE_PI_PLATFORMS_2026_10_25.md).
The payload is the same bytes for every target (a JavaScript connector run by the
host's own Node), so a target is declared only after its own OS and architecture ran
the native loopback test: `scripts/qualify-native.mjs` refuses a run unless this Node
build's platform and architecture equal the target (and, as extra guards, macOS is not
translating the process under Rosetta and the Linux `uname -m` matches), and
`--environment hosted` additionally requires the GitHub runner variables for that
target. These are guards against operator mistakes, not attestations; the manually
dispatched `pi-provider-qualification` workflow produces the hosted runner evidence.

To qualify the machine you are on (Node `>=22.19.0 <23.0.0`, Pi `0.85.1` installed, the
reviewed `cadencr` CLI checksum known; no credentials or network model are used):

```sh
node plugins/providers/pi/scripts/qualification-input.mjs \
  --target <this-machine-target> --output /absolute/new/input.json
node plugins/providers/pi/scripts/prepare-candidate.mjs \
  --source-commit <full-clean-HEAD-commit> --candidate-target <this-machine-target> \
  --runtime external-node-pi --package /absolute/new/input.json \
  --cli /absolute/reviewed/cadencr --cli-sha256 <sha256> --directory /absolute/new/candidate
node plugins/providers/pi/scripts/qualify-native.mjs \
  --target <this-machine-target> --archive /absolute/new/candidate/pi-0.4.1-<target>.tar.gz \
  --pi "$(command -v pi)" --environment local|container|hosted \
  --evidence /absolute/new/evidence.json
```

The evidence file records the extracted payload digests, versions, host OS/arch and
loopback result without local paths, and the scratch directory is removed after a
pass (kept and named after a failure). `container` evidence (a Linux container on a
Mac) is recorded as such and never as hosted or bare-metal evidence.

[`package-template.json`](package-template.json) fixes the discriminated provider
kind, Pi identity, source repository, Apache declaration, executable and assets.
Only targets whose native loopback qualification passed (all four macOS and Linux
targets today) appear in that source-owned template's `distribution.binary`;
the marketplace filters packages by the user's platform, so there is no fixed matrix.
Its publisher is the official `cadencr` publisher and its first compatible desktop is
`0.15.0`. The archive URL and digest stay `PENDING` placeholders and publication stays
closed, so it is **not yet a published package**. The release preparer supplies a
source-tag-bound archive URL only after a reviewed release policy selects the
target/payload.

The local candidate command still accepts the inner legacy `{agent, host}` object,
not the discriminated template wrapper. An operator must explicitly select one
target and provide reviewed candidate publisher, compatibility and HTTPS archive
values. No production publisher, application compatibility floor or native-target
approval is inferred from a successful pack. The template/readiness documents stay
outside the payload; the payload remains `bin/`, README, license and artwork only.
