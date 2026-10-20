# Pi native candidate evidence — 2026-10-17

## Scope and verdict

Partial native macOS arm64 evidence, not publication approval or full provider
qualification. The extracted canonical connector launched separately installed
actual Pi. Pi itself was not bundled in the archive. No model
prompts, model tools, paid requests, personal Pi authentication, installation,
signing, or publication were performed.

The successful lifecycle case used explicitly synthetic model configuration with
a literal noncredential placeholder and an inert loopback endpoint. It proves
native process/protocol lifecycle only, not authenticated model compatibility.

## Source and artifact identity

| Item                           | Observed value                                                     |
| ------------------------------ | ------------------------------------------------------------------ |
| Source commit                  | `da8849bf4c573db1ffe27f5153e171c0aee4aaf7`                         |
| Source path                    | `plugins/providers/pi`                                             |
| Connector version              | `0.4.0`                                                            |
| Native platform                | macOS, `darwin/arm64`                                              |
| Candidate target               | `darwin-aarch64`                                                   |
| Node                           | `22.19.0`                                                          |
| Actual Pi                      | `0.85.1`                                                           |
| Runtime policy                 | `external-node-pi`; neither runtime bundled                        |
| Archive                        | `pi-0.4.0-darwin-aarch64.tar.gz`                                   |
| Archive bytes                  | `23829`                                                            |
| Archive SHA-256                | `0ce87b036f6e7e216816153db8960689460c3563271bd445b8f97ae68f26461f` |
| Reviewed local CLI SHA-256     | `6911c341ece0039d1b10df5ded9223b9b8882510230ed0b9ac632b20c283efa9` |
| Final package metadata SHA-256 | `642bdee514f5ef0bb23d0be223bab2e6b05961a62ae82d52cc3f7197c779e64d` |

`prepare-candidate.mjs` ran against clean committed Pi source using explicitly
TEST-ONLY operator input and a nonproduction URL. These inputs are not official
publisher identity, release compatibility approval, or remote provenance.
The receipt retains `unverified-local-checkout`, publication `PENDING`, and
qualification `PENDING`.

## Checks

| Case                                | Result                                                      |
| ----------------------------------- | ----------------------------------------------------------- |
| Canonical Rust archive preparation  | Passed                                                      |
| Second canonical archive            | Byte-identical to first                                     |
| Independent archive digest and size | Match receipt                                               |
| Extraction                          | All 15 payload files byte-match staging; no symlinks        |
| Extracted launcher executable bit   | Present                                                     |
| Extracted connector `version`       | `0.4.0`, exit `0`                                           |
| Isolated actual Pi `--version`      | `0.85.1`, exit `0`                                          |
| Empty-config model discovery        | Expected negative: no available models, exit `1`            |
| Empty-config ACP initialize         | Protocol `1`, passed                                        |
| Empty-config `session/new`          | Explicit no-available-models error                          |
| Empty-config config/close           | Skipped because session creation failed                     |
| Synthetic-config model discovery    | One synthetic model                                         |
| Synthetic-config ACP initialize     | Protocol `1`, passed                                        |
| Synthetic-config `session/new`      | Passed; live selector matches discovery                     |
| Synthetic model setter              | Accepted existing value; returned current value matched     |
| Synthetic auto-compaction setter    | Accepted existing value; returned state/change not asserted |
| Synthetic `session/close`           | Passed                                                      |
| Both connector shutdowns            | Exit `0`                                                    |

The synthetic session exposed `model`, `thinking_level`, `auto_compaction`,
`steering_mode`, and `follow_up_mode` config identifiers. Model and
auto-compaction setters re-submitted their existing values; changing settings
was not tested.

## Actual generic service boundary

With coordination from the owner of a separate isolated current-source QA
service, the local-descriptor API accepted a TEST-ONLY provider pointing at an
owned isolation wrapper around the extracted launcher. The wrapper clears the
inherited environment and supplies only scratch configuration/runtime inputs.

- Registration returned HTTP `200`, inactive immediately, restart required.
- After the owner restarted that service, diagnostics returned HTTP `200`:
  enabled and registered, no quarantine, no rejected descriptors.
- The actual generic agent catalog returned HTTP `200`, provider available,
  origin `installed_local`, and the single inert synthetic model.
- Catalog profile scoping does not filter the full response or normal built-in
  discovery; this was not treated as Pi-specific isolation evidence.
- No project or conversation was created. Generic-service ACP session runtime
  creation/config/close was not exercised: no safe independent prompt-free
  service session lifecycle was established during this bounded check.

Local-descriptor admission and catalog discovery are **not** signed-feed
admission, managed installation, or managed ACP conformance certification.

## Safety, cleanup, and retained evidence

Native Pi children used owned scratch HOME, config, workspace, session storage,
and temporary storage. Version checks were disabled during Pi lifecycle checks.
No user Pi configuration or authentication was copied or inspected.

An additional macOS network sandbox attempt was refused by the environment.
A loopback request-counting listener was also refused. Consequently, no OS
network-isolation or independently observed zero-network-traffic claim is made.
No prompt requests or model tool requests were sent.

Connector shutdown was awaited and returned exit `0`; this does not independently
prove absence of every descendant process. Scratch was retained rather than
recursively removed. The initial archive/scratch verification found no unexpected
database files. The coordinated service owner retains its QA database and stops
its own servers; no database deletion or replacement was requested.

Private retained evidence basenames: `candidate.json`, `package.json`,
`native-report.json`, `synthetic-native-report.json`,
`archive-verification.json`, `host-registration.json`, `host-inventory.json`,
`host-catalog.json`, `host-descriptor.json`, and the two canonical archives.
Private host responses are not publication artifacts.

## Remaining gates

- Real configured/authenticated model discovery and explicitly approved turns.
- Text/thinking streaming, tool permissions, cancellation, durable resume, usage,
  error behavior, and active-turn cleanup against real Pi models.
- Generic-host ACP session lifecycle and managed conformance.
- Signed-feed verification and managed installation, update, and failure-recovery boundaries.
- Independent process-tree/network-policy qualification.
- Native macOS x86_64 qualification; no inference from arm64.
- Artwork provenance, licensing review, production publisher authority, release
  metadata, distribution/runtime approval, signing, and publication.
