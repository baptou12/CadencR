# Qualified CLI pin and delivery preparation review — 2026-10-21

## Scope and authority

This record covers **local binary selection and bootstrap/cutover review
preparation only**. It does not record a production pin adoption, bootstrap merge,
workflow deployment, publication, new hosted QA run or desktop activation.
No production protections, credentials, signing authority or official plugins
are changed by this preparation.

## Exact selected executable

| Binding              | Reviewed value                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| CLI                  | `0.13.1-dev.39306959010.1`                                                                     |
| Tag                  | `cli/v0.13.1-dev.39306959010.1`                                                                |
| Source               | `646864caeca2896170baa65d5389b475099b2ce1`                                                     |
| Linux x86-64 SHA-256 | `251c5d0cc7120ccc44dc2d8ad473bd5bb31e3577542098feb72f31372ed7b88a`                             |
| Asset                | `cadencr-v0.13.1-dev.39306959010.1-x86_64-unknown-linux-gnu`                                   |
| Release              | [CLI-only run 39306959010](https://github.com/merkr-software/CadencR/actions/runs/39306959010) |
| Qualification target | `merkr-software/cadencr-registry-qa`, ID `1420296872`                                          |

The three locally selected files are `tooling/marketplace-registry/ci/released-cli.env`,
`scripts/official-plugin-author-cli.env` and `scripts/cli-qualification.env`.
Selection derives from released metadata and exact checksum/provenance/tag/source
bindings, not a source-built substitute. Current helper/workflow bytes match the
published source above; the new local pin values are not claimed to have existed
at that source commit, nor is the current uncommitted checkout claimed published.

The [October 21 qualification](MARKETPLACE_RUST_CUTOVER_QUALIFICATION_2026-10-21.md)
is the evidence authority: 65 networkless checks, nine original-author lifecycle
runs across providers/themes/tabs, mixed incremental publication and first-pass
renewal of 11 entries / 14 archives, unchanged replay and fresh-runner recovery.
Do not broaden that evidence to Pi execution, native targets, desktop consent,
theme activation or packaged-client behavior. The historical failed renewal
remains failed; its exact cause is unknown.

## Read-only registry observation

| Binding                               | Observed value                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Production contribution repository ID | `1378674060`                                                                                              |
| Default `main`                        | `24656f0f1ceb23576b0be9449c86c6d09e24f5b3`                                                                |
| Bootstrap PR                          | `1`, open and unmerged                                                                                    |
| PR head                               | `ce91da92811382ff571ed8ffbdf21a9990497d86`                                                                |
| Active validation                     | Legacy JavaScript only; Rust cutover not deployed                                                         |
| Protections                           | One approving review, CODEOWNER review, last-push approval and administrator enforcement remain unchanged |

This is a dated read-only observation, not an assertion that local preparation
changed the remote. Reinspect heads, protections and approvals before delivery.
Do not bypass governance or infer authority from binary qualification.

## Regenerated delivery artifact review

- Bootstrap refresh `review-v2/01-bootstrap.patch` is prepared against the
  observed PR head above and leaves the active workflow unchanged.
- `review-v2/02-ci-cutover.patch` selects the trusted-base Rust workflow only **after
  the actual bootstrap merge**. It is not an instruction to apply both patches
  together or deploy directly from the current PR head.
- Refreshed bootstrap changes three PR-head paths: `ci/released-cli.env`,
  `SOURCE_PROVENANCE.md` (provenance document) and
  `scripts/ci/validate-provider-contribution.sh`. Its full delta from observed `main`
  contains five paths; cutover changes the workflow only.
- Actual patch application and dry-run checks passed in private snapshots, with
  exact expected bytes/modes. Complete file maps verified unchanged content
  outside the explicit allowlists. Current helper/workflow source equality was
  checked against the published CLI source.
- The manifest binds all 14 public qualification runs and the local qualification
  document digest below. That document was inspected at local baseline `a7328b604`,
  not claimed published at CLI source `646864caeca2896170baa65d5389b475099b2ce1`.
- Prior payload approvals cannot authorize these changed bytes. Integrated test
  results are recorded separately; local checks are not deployed hosted CI.

| Private review artifact / evidence      | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| `review-v2/REVIEW_MANIFEST.json`        | `dccd38cd6c0ecbacd1cc78f8292ee4ecb7f25c1b8381d02290161a46ec62c812` |
| `review-v2/01-bootstrap.patch`          | `b44bc8ba2849b05c0e93a9a7837634f235396fc59080b1cc3514a6317aa48821` |
| `review-v2/02-ci-cutover.patch`         | `9c356b060f2c8031473de777533e9207804a2e291548fd7ab1a51eed62319191` |
| Local October 21 qualification document | `3e3a77377b6b378296d1d43c00acd36b7f459416aaed9269cedea1cc04fb07bd` |

Review artifacts remain private preparation; no raw snapshots, temporary paths,
accounts, credentials or keys belong in this record.

## Remaining delivery gates

- [ ] Fresh approval of exact regenerated payloads and production pin adoption.
- [ ] Actual bootstrap merge, then separate trusted-base CI cutover review-v2/merge.
- [ ] Hosted provider/theme/tab contribution checks on the deployed workflow.
- [ ] Explicit author-policy and `plugins/release-policy` publication authority;
      choosing an executable grants neither author nor catalog signing authority.
- [ ] Production trust/feed/signing environments, owners, monitoring and recovery.
- [ ] Official Graphite/Ember/Fjord/Pi publication and signed-feed population.
- [ ] Pi artwork provenance and native target matrix approval.
- [ ] Runtime and clean packaged-client lifecycle qualification; public desktop
      activation remains separately authorized and deferred.
