# Stable CLI marketplace qualification — 2026-10-23

## Distributed offline gate: passed

[Run 40029236838](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40029236838)
executed the downloaded Linux ELF without network access or inherited credentials.
All **91 checks** passed. This is not a local-source substitute for the released
binary and does not yet qualify its online publication lifecycle.

| Binding                           | Value                                                              |
| --------------------------------- | ------------------------------------------------------------------ |
| CLI version / tag                 | `0.14.1` / `cli/v0.14.1`                                           |
| CLI SHA-256                       | `8bc82e23a39f4a379713b47770fd4e0752574a7175c40e6dda932bd6d1beea73` |
| CLI source                        | `96100e5c9ae5741f5757158c8d946991be6eb300`                         |
| Reviewed QA commit                | `92b97cac43126f73e6aadb86b7bf573bf6540096`                         |
| Artifact ID                       | `12533269781`                                                      |
| Artifact ZIP SHA-256              | `928fbc237f3a1f34cc7211a1249309aa1d41bbfd1e118d47586f4f883df519eb` |
| Extracted `evidence.json` SHA-256 | `4ba80cf99ca25ebdfad937d0cb0b35f39ce247d26e753e7b926a84853fb809ed` |

The downloaded ZIP matched GitHub's artifact digest and contained only the
allowlisted `evidence.json`. Its binary/version identities, successful status,
check inventory and qualification boundaries were inspected independently.

## Covered behavior

- Provider, theme and UI-only tab validation, deterministic packaging,
  contribution checks, mixed catalog signing/verification and policy expiry.
- Separate native tab UI and backend archives for macOS arm64, macOS x86_64
  and Linux x86_64, including complete multi-platform metadata and author request
  inspection.
- Rejection of unknown protocols/targets, manifest/metadata binding drift,
  modified archive/executable bytes, nested packages and nonfinite theme colors.
- Native fixtures are inert headers, never executed. Native conformance and
  managed archive installation remain unqualified by this run.

## Failure retained

The initial [run 40028321251](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40028321251)
failed before fetching or executing the CLI: the QA workflow guard accepted only
development versions. The reviewed correction accepts canonical stable versions
and the existing exact development format while preserving repository, workflow,
commit, tag and checksum bindings. Four network-free regression tests exercise
the actual guard and fetch preflight. The failed run is not reported as passing.

## Remaining gates

- Original-author publication, interrupted draft recovery and exact retries.
- Mixed signed-catalog publication, interruption/resume, fresh-runner recovery
  and renewal against preserved QA history.
- Reviewed promotion of monorepo and registry pins only after those gates.
- Production authority, official plugin publication and actual client QA.

No production key, pin, feed, plugin release or marketplace visibility changed.
