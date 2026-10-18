# Distributed CLI qualification — 2026-10-18

## Scope and exact executable

This qualifies **distribution orchestration**, not desktop installation or plugin
runtime behavior. Only the isolated public `merkr-software/cadencr-registry-qa`
repository was mutated. Production pins, signing authority, registry and desktop
visibility remain unchanged. All provider/tab payloads are inert and never run.

| Binding                  | Value                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Released CLI             | `0.13.1-dev.39108033875.1`                                                                               |
| Source commit            | `88ead507983371e5c3df468c6d9bf7c6c12e5fbb`                                                               |
| Linux executable SHA-256 | `d11bfade6297fa30e1e10e82605f5a221da8e07edeeee372e2c2f6185c6ff725`                                       |
| Platform                 | `x86_64-unknown-linux-gnu`                                                                               |
| Delivery                 | [CLI-only release](https://github.com/merkr-software/CadencR/releases/tag/cli/v0.13.1-dev.39108033875.1) |

The four distributed release assets, checksum, provenance and source-tag binding
were independently checked. Hosted jobs downloaded that exact ELF; no local
source-built binary substituted for it. Development regression tests are separate.

## Hosted evidence

| Scenario | Offline                                                                                       | Public publication / interruption                                                             | Separate fresh runner                                                                         |
| -------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| provider | [39121644092](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39121644092) | [39121664466](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39121664466) | [39121723703](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39121723703) |
| theme    | [39120858003](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39120858003) | [39120877981](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39120877981) | [39120934544](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39120934544) |
| tab      | [39121802085](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39121802085) | [39121828269](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39121828269) | [39121874148](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39121874148) |

- [Networkless three-kind qualification](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39120437491): **30 checks**,
  including deterministic archives, strict contributions, tab metadata bindings,
  malformed/nested inputs, non-finite colors, signatures and mixed schema-2 data.
- Author jobs verify content-bound requests, wrong confirmations, actual public
  releases, two exact retries, each changed asset/request rejected, unchanged
  inventory, and recovery of an observed empty draft under the same release ID.
- [Mixed incremental registry lifecycle](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39121979554): two historical
  versions preserved plus one provider, theme and tab; **5 entries, 6 archives**.
  A TLS-blind controlled transport interruption occurs after the theme mirror is
  public. Same-state resume/replay and a separate clean runner preserve all remote
  release/asset identities and discovery bytes. No pipeline artifacts are restored.

## Renewal: uncertain outcome, then exact recovery

- [Initial renewal](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39122296869) published the catalog and advanced
  discovery, then the CLI returned an error. Its raw diagnostic was not retained;
  **the original cause remains unknown**. Stale raw CDN bytes are a hypothesis,
  not an established diagnosis. The initial workflow is not claimed to be green.
- [First original-intent recovery](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39122903399)
  verified the fresh CLI recovery and unchanged inventory. A later independent
  harness GET failed with `fetch failed`; its sanitized message digest identifies
  this read failure, not the initial CLI error.
- [Completed original-intent recovery](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39123128300) authenticates the
  existing catalog and complete reviewed inventory before creating signing-key
  material. The same original request, timestamps, baseline and operation commit
  are replayed twice from fresh state; neither replay changes discovery/releases.
- GET transport retries are capped at three attempts under the caller's existing
  deadline, with abortable backoff. Integrity, HTTP, JSON and abort failures remain
  terminal. There is **no new-publication retry wrapper**, replacement request,
  regenerated date, discovery reset, lock removal or restored state.

| Immutable recovery binding      | Value                                                              |
| ------------------------------- | ------------------------------------------------------------------ |
| Original operation commit       | `15a797ebfe0f108873471de63052fac3283ba768`                         |
| Original request SHA-256        | `2cd78368ffe6f1831aabbbca023e6e5c20f54f792b85f2f4b3505058fbfdbbf0` |
| Recovery plan SHA-256           | `6d67f6ee938af3101a691236dfec94cc7c4871b53254bf5501453a4cb377d2cc` |
| Mixed catalog SHA-256           | `3bfe19ba7ccae6a742703c63a7797da849bcc467c668b0a0616fb777fccbc0ef` |
| Renewed catalog SHA-256         | `c7363e0af236bb38b16dc6a1f88fca7922ad56a6d6856852d88aed72c47f8ebf` |
| Unchanged inventory SHA-256     | `98e7ea81683a4384b41192bbbc9cbd54e363b84a8abd08e6b259da7c4d8a6b66` |
| Fresh recovery proof SHA-256    | `5f16e96e8b9ba1cc28bfa1d94a1edd57ab3a411203f98a26f74a3ccf94e834e7` |
| Same-state replay proof SHA-256 | `8e4f2be45431fcded53ec49ebe2267e5b08c0cf15095d264c359c6088d42b5b5` |

The signed catalogs remain public immutable release assets. Job artifacts retain
only allowlisted key-free proofs and signed catalog bytes, never credentials,
private state or raw CLI output. Artifact retention is 14 days; the run IDs and
content bindings above remain the dated audit references. A durable
[key-free QA summary](https://github.com/merkr-software/cadencr-registry-qa/blob/main/qualification-three-kind.json)
retains the run and content bindings.

## Corrections made during qualification

- Canonicalize Python roots: mixed symlink/canonical temporary paths must not break
  source-inventory verification on macOS.
- Track the inert tab's compiled `dist/index.html` entry through narrow ignore
  exceptions; an uncompiled root HTML entry is correctly rejected by Rust.
- Include and bind the inert provider's README/license. Author preparation now
  runs Rust publication planning, not merely looser catalog validation.
- Keep original failed candidates/tags/releases untouched. Corrected provider/tab
  fixtures use new immutable source tags rather than replacing published bytes.
- Sanitize failure diagnostics to bounded codes/statuses and message hashes.

## Validation and limits

- Final script suite: **294 passed, 0 failed, 0 skipped**, including the explicit
  development CLI regressions. Rust CI enables those fixture-contract regressions.
- Repository lint, targeted script lint, formatting, desktop type checks and
  `git diff --check` pass. Three independent finish-job reviews found no blocker.
- This is not ACP execution, tab renderer/consent, theme activation, managed app
  installation/update/restart/removal, official Pi packaging qualification, key
  rotation/revocation qualification or arbitrary HTTP mutation-response-loss proof.
- No database was touched. No monorepo commit or production pin promotion is
  authorized by these QA runs. Next gate: separately review exact pin promotion
  and regenerate dependent bootstrap/cutover hashes before production deployment.
