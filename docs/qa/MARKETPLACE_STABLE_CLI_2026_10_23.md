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

## Original-author lifecycle: passed

All three kinds completed offline inspection, real QA publication with an
observed empty-draft interruption, exact-request resume, and an independent
fresh-runner replay. Every public run also verified two retries and rejection of
changed assets/requests without changing the immutable release inventory.

| Kind     | Offline run                                                                                   | Publication / interruption                                                                    | Fresh runner                                                                                  |
| -------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| provider | [40030116584](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40030116584) | [40030237781](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40030237781) | [40030394814](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40030394814) |
| theme    | [40030500953](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40030500953) | [40030645307](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40030645307) | [40030853798](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40030853798) |
| tab      | [40030959745](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40030959745) | [40031038068](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40031038068) | [40031234897](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40031234897) |

All candidates bind fixture source `bccab3b3b642fd38b8cb361ac35db92ef337e6b4`
and distinct immutable `qa-author-cli/stable-0141-<kind>-20261023` tags in the QA
repository. Published fixture version is `1.0.3`; previous versions are untouched.
Provider publication contains two platform archives; native-tab publication
contains one UI archive and three separate backend archives. The fixtures were
never executed. These releases are not official plugins or production entries.

Artifacts were independently downloaded and checked against exact run/commit,
candidate, binary and request identities. Offline/public/fresh request hashes and
source fixture inventories agree. Public/fresh release and asset IDs, sizes and
digests agree. The native generator is itself part of the source-bound inventory.

## Incremental signed catalog: passed

[Run 40031564639](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40031564639)
passed publication, controlled interruption/resume, same-state replay and an
independent fresh-runner replay. All four receipts refer to byte-identical signed
catalogs and identical complete release/asset inventories.

- QA operation commit: `606fdc2830fed2a14994212bd17bc1540cc8799c`.
- Request SHA-256: `4555568c8adfd131f7b59d5e8bcc6f5f33f8bb12abbb1f36125bf5b788974c67`.
- Catalog SHA-256: `73859a9154828f8d49d52f367960174adb7e166f8be3f0aa09432d59bc9a6187`.
- The previous 11 entries remain unchanged; three new `1.0.3` entries bring the
  catalog to 14 entries and 21 archive URLs, including all native-tab targets.
- Window: `2026-10-23T22:04:57Z` to `2026-10-30T22:04:57Z`.

## Renewal failure: publication completed, convergence check failed

[Run 40032302758](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40032302758)
failed with `REGISTRY_PIPELINE_FAILED`; its fresh-runner job was skipped. The
sanitized message digest exactly matches the source literal
`public discovery: convergence read budget exhausted`. The released implementation
stops after four reads even when its 30-second convergence deadline has not
elapsed. Only the authenticated previous catalog can take that retry path.

A subsequent read-only audit found the new catalog already published and the
discovery branch serving exactly those bytes:

| Binding                   | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| Original operation commit | `b63364e2f84e9e5e0cadbb05134d6b7db8a94854`                         |
| Request SHA-256           | `b6201b5e76ad91fecee2c3c2629b518875d90f9f4e88b9035f263b4e3297b739` |
| Original plan SHA-256     | `9a3d0a2dc713a1cb2c5576e3e7db20436ed7917690e0b89eb06995147f727259` |
| Renewal catalog SHA-256   | `9001895ef154cb0c312032b22dce73e593b8ac36a86924d5dee5224ab61fdb30` |
| Discovery head            | `cf2cd4228df8c7321d913020f414163b44a848d5`                         |
| Catalog release / asset   | `422356223` / `670562628`                                          |
| Fixed validity window     | `2026-10-23T22:12:32Z` to `2026-10-30T22:12:32Z`                   |

All 14 package entries and 21 archive URLs are unchanged. All 41 prior releases
and their asset identities/digests/timestamps remain unchanged; the only addition
is the renewal catalog, giving 42 releases. Source CLI signature verification
supports this audit, but is **not** distributed-ELF recovery qualification.

The source correction removes the four-read ceiling, not the 30-second deadline,
250ms pause, previous-body restriction or per-retry authority/freshness checks.
Tests cover six previous observations before convergence, later authority drift,
deadline exhaustion, cleanup failure and absence of a second discovery write.
All 169 publisher tests and strict Clippy pass. This does not establish that
30 seconds covers every CDN delay, nor put the correction in released `0.14.1`.

Recovery must reuse the original request, commit and dates in fresh scratch,
then prove unchanged complete remote inventory. No ordinary first-job rerun,
replacement timestamps, feed reset or restoration of prior local state is allowed.
The failed run remains failed even if a separately reviewed recovery succeeds.

## Original-intent recovery: passed

Two independent workflows at reviewed QA commit
`17aa1317f7a58695b66053022e6edc0d86ea4e1e` passed with the exact distributed
`0.14.1` ELF. Each authenticated the published candidate and every archive before
replaying the original request into fresh scratch, then replayed it again using
that scratch. Neither workflow restored prior receipts, artifacts or local state.

| Run                                                                                           | Artifact ID   | Result                                                  |
| --------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------- |
| [40033620593](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40033620593) | `12536271274` | Fresh recovery and same-state replay passed             |
| [40033732972](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40033732972) | `12535278749` | Independent fresh recovery and same-state replay passed |

- Recovery plan SHA-256: `5e38c50f02d62c37a3bd83607731ccb42d1bc0196a49f392d53eb723cf381083`.
- All four proofs bind the **original** operation commit, request, plan and fixed
  window above; the workflow delivery commit is not substituted for that intent.
- Both downloaded artifacts contain exactly three byte-identical signed catalog
  files and two successful proofs, with no failure file. Their digests, run/head
  identity, strict proof fields and immutable committed inputs were checked.
- The unchanged complete remote inventory hashes to
  `9a61b85ebf21b741c68283a8f7bca2f32e6d639fe98d2cd08b40f54daa144f99`:
  42 releases, the same asset identities/digests, 14 entries, 21 archive URLs and
  unchanged discovery head `cf2cd4228df8c7321d913020f414163b44a848d5`.

The original failure remains recorded. These successful delayed recoveries prove
reconciliation, not successful initial convergence under CDN lag. Source fix
`1d998241b` still requires integration and a newly distributed CLI qualification.
Local verification: 169 publisher tests and strict Clippy passed; the full scripts
run with explicit source-CLI paths passed 339 tests without skips. Normal commit
hooks also passed, with eight optional source-CLI tests skipped in that hook-only
environment. No frontend or managed-install behavior is qualified by these runs.

## Remaining gates

- Deliver and qualify a CLI containing the convergence correction before
  production promotion; a successful delayed replay does not fix the old binary.
- Reviewed promotion of monorepo and registry pins only after those gates.
- Production authority, official plugin publication and actual client QA.

No production key, pin, feed, plugin release or marketplace visibility changed.
