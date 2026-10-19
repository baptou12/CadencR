# Rust-only CLI cutover qualification — 2026-10-18

## Scope and executable

This record follows the earlier [three-kind qualification](MARKETPLACE_CLI_QUALIFICATION_2026-10-18.md)
without overwriting its binary bindings or failed-run history. It qualifies
registry/author distribution orchestration, not desktop installation or plugin
execution. Only the existing public QA repository was mutated. Production pins,
authority, feeds and desktop visibility are unchanged.

| Binding              | Value                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| CLI                  | `0.13.1-dev.39144478778.1`                                                                         |
| Source               | `50aae277d9cae56ec2e261d2f5df904f0ec5c3ee`                                                         |
| Linux x86-64 SHA-256 | `be5a15c9d065670466511fa9e23ce6e5205c73fade4a5ed9320b262296fbb122`                                 |
| Delivery             | [CLI-only development release](https://github.com/merkr-software/CadencR/actions/runs/39144478778) |
| QA source fixtures   | `e47b9f3bcad3c55eb896dfa52850809ab8e2e26f`                                                         |
| QA target            | `merkr-software/cadencr-registry-qa`, repository ID `1420296872`                                   |

Canonical source CI, CodeQL and audit passed before release. The four downloaded
release assets, checksum, ELF header, provenance, tag and source binding were
independently verified. Hosted jobs execute that exact downloaded ELF. A local
source-built executable is used only for development tests and request preparation,
never substituted for distributed-binary evidence.

## Networkless qualification

[Run 39145349862](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39145349862)
passed **65 checks** in a networkless Ubuntu namespace, with privileges dropped
and no inherited credentials. It covers all three kinds, deterministic packaging,
strict contribution boundaries, signatures/tampering, and the new Rust commands
`validate-metadata`, `validate-submission` and `check-metadata-expiry`.

New checks assert success payloads, exact semantic rejection exits/JSON codes,
empty failure stdout, healthy/expiring/expired reports and untrusted-signature
channels. Valid oversized JSON, symlinks and FIFOs are tested independently of
malformed inputs. Offline evidence intentionally leaves lifecycle qualification
false; the separate online evidence below supplies those scenarios.

## Author lifecycle

New immutable QA `1.0.1` metadata/source tags preserve all prior `1.0.0` releases.
Provider and tab payloads are inert and never executed.

| Kind     | Interrupted publication and exact retries                                                     | Separate fresh runner                                                                         |
| -------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Provider | [39145464562](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39145464562) | [39145648513](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39145648513) |
| Theme    | [39145769283](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39145769283) | [39145841221](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39145841221) |
| Tab      | [39146640708](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39146640708) | [39146710883](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39146710883) |

Each initial job observes an empty remote draft, terminates its owned CLI process
and resumes under the same release ID. It checks public asset bytes, two exact
retries, and changed asset/request rejection without remote inventory changes.
The separate runner repeats the same content-bound request without restored state
and retains exactly the original release/asset identities.

### Preserved failed tab attempt

[Run 39145893752](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39145893752)
passed offline checks but failed online before any observed draft/release. Its
generic diagnostic did not establish the cause; rate limiting or CDN behavior
must not be reported as a confirmed explanation.

A reviewed observability-only patch adds closed, bounded diagnostic codes,
categories, HTTP status and operation labels. It never exports exception messages,
arguments, URLs, credentials or scratch paths. The successful retry uses the same
candidate, fixtures, source tag and request SHA-256:
`4c22adb9a8ab80e36abe416a116d02d9ef4edec4808a8f4019c814d8baf355e2`.
The failed run remains part of the audit history, not relabeled as successful.

## Registry publication and renewal recovery

[Incremental run 39146858795](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39146858795)
passed on its first and separate fresh runners. The five existing entries remain
unchanged; three immutable `1.0.1` versions produce **8 entries and 10 archives**.
A controlled transport interruption after the theme mirror becomes public is
followed by same-state resume/replay and clean-runner reconstruction. Remote
release/asset identities and discovery bytes remain stable across all replays.

### Renewal published, then returned an error

[Initial renewal 39147214594](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39147214594)
**failed**, despite publishing its signed catalog and advancing discovery. The
allowlisted diagnostic records exit `1`, `REGISTRY_PIPELINE_FAILED` and message
digest `775efb2e87756c1553615fe5f0528b0d8601594d94f835df34a49be28eaa01b8`.
That digest matches the released source's `archive download: SHA-256 mismatch`
message. The specific response bytes/URL were not retained; a stale raw-feed CDN
response is not established as the cause.

[Original-intent recovery 39147499709](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39147499709)
passed. Before creating ephemeral signing-key material, the hosted ELF and harness
authenticate both signed catalogs, complete inventory/discovery and all ten archive
bytes. Fresh-state recovery and same-state replay reuse the original request,
window, baseline and operation commit. Neither replay changes the full inventory
or discovery. The workflow commit is separate from the operation commit; no state
artifact, reset, replacement request or new timestamp is used.

| Immutable binding                    | Value                                                              |
| ------------------------------------ | ------------------------------------------------------------------ |
| Incremental operation commit         | `37920ba7a26835ec85de6f717d0d7ccd6a20291f`                         |
| Incremental request SHA-256          | `76c1b630f19ce147477dcd62bde3b33a481dcb36fc5dc1dd32c1bc932e340669` |
| Incremental catalog SHA-256          | `010e978b1a3bd3aed7cabc4d4cb9833b94de0054aa180fdbf7a179d21dd1113d` |
| Original renewal operation commit    | `e8fbdc424dfc14717db2ea4ca325e35d169a00c4`                         |
| Original renewal request SHA-256     | `f1cf2b60e13f5c867f0b72de4b60ee48bfa3400f4d6aa7b2faf94d705b349c8d` |
| Recovery workflow commit             | `30b1453867801325ed0340434501b9ea1923cce3`                         |
| Recovery plan SHA-256                | `a65c0dbe97e1dbac38cdc547b811dde9ebc308f96bf8accd61fa4b163b50cde3` |
| Renewed catalog SHA-256              | `a6a71f22e262ac1bc0f9c0843d2ed1590a616a101b4a3de47fbea55a000bf95c` |
| Unchanged recovery inventory SHA-256 | `34e02dfa33f58598915752aa69eb9ff40df6ede70a6585994c77e9a06cfe528a` |
| Fresh recovery proof SHA-256         | `33259020f1e11766145cdafff3914ec1c7d75d6e71fc9ce7b2bb5d2a1c8dd791` |
| Same-state replay proof SHA-256      | `5a6bf2ada48179fa2c23ca8dc11161fa23bcc5c9e4a2760978a81e94b6ad8dff` |

The first renewal is **not** reported as green or production-ready. Diagnose and
address its post-publication error, then demonstrate first-pass renewal without
bypassing integrity verification before production pin promotion. If Rust changes
are required, release and qualify that corrected binary separately.

A durable [key-free summary](https://github.com/merkr-software/cadencr-registry-qa/blob/main/qualification-rust-cutover-39144478778.json)
retains exact run/content bindings and both failed attempts. Temporary job
artifacts contain only allowlisted proofs/signed catalogs, expire after 14 days,
and are never restored into replay jobs.

## Development checks and review

- Scripts: **300 passed, 0 failed, 0 skipped**, with explicit development CLI paths.
- Author Python guards: **24 passed**, including the development fixture test.
- Targeted lint, formatting, shell syntax and `git diff --check` pass.
- Three finish-job reviewers checked the helper changes and the QA recovery
  bindings. No finding was dismissed by relabeling a failed hosted run as green.

## Remaining acceptance boundaries

- This is not managed desktop install/update/restart/removal, theme activation,
  tab consent/rendering, Pi ACP execution or native-target qualification.
- Production executable pin promotion, rebuilt delivery manifests/approvals,
  production deployment/authority, official plugin releases and consumer QA remain
  separate gates. `scripts/cli-qualification.env` is qualification-only.
- No database, desktop release, marketplace activation or production signing key
  was touched. Monorepo changes remain subject to a separate commit approval.
