# Registry delivery — 2026-10-21

## Delivered registry orchestration

| Delivery                          | Public evidence                                                           | Exact registry commit                      |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| Bootstrap                         | [PR #1](https://github.com/merkr-software/cadencr-registry/pull/1) merged | `efe2dc72f08a50bd30921e0fa7d1c4c959071f16` |
| Trusted-base Rust contribution CI | [PR #2](https://github.com/merkr-software/cadencr-registry/pull/2) merged | `bb19ac8be430672fce167541e5830f33c70968bc` |
| Legacy JavaScript retirement      | [PR #7](https://github.com/merkr-software/cadencr-registry/pull/7) merged | `8731ca0551e753b02f10297c6fdb66c65e78026b` |

[Hosted run 39676576520](https://github.com/merkr-software/cadencr-registry/actions/runs/39676576520)
completed successfully: `inert-metadata` and `contributor-tooling` both passed.
The run used head `3fa9a7d03ddf8c9e03168cfacda3a91cf1ddc3f6` against bootstrap
base `efe2dc72f08a50bd30921e0fa7d1c4c959071f16`, before PR #2 merged.
This was an **empty-registry** run: populated unsigned-index validation was
skipped. It does not prove populated provider/theme/tab contribution validation.
The delivery status also records 43 portable registry source tests passing.

## Populated hosted qualification

All eight jobs across four draft QA PRs returned the expected results. Each PR
was subsequently closed **without merge**; `main` was then
`bb19ac8be430672fce167541e5830f33c70968bc`. No QA package metadata reached `main`.

| Case                                                       | PR / hosted run                                                                                                                                                 | Expected and observed result                                                                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Provider, theme and tab metadata with matching submissions | [PR #3](https://github.com/merkr-software/cadencr-registry/pull/3) / [39677653340](https://github.com/merkr-software/cadencr-registry/actions/runs/39677653340) | Both jobs passed; unsigned `build-index` ran, not skipped.                                                                          |
| Malformed theme version                                    | [PR #4](https://github.com/merkr-software/cadencr-registry/pull/4) / [39677662221](https://github.com/merkr-software/cadencr-registry/actions/runs/39677662221) | Both jobs failed as expected: `theme.version must be semantic version`.                                                             |
| Existing-version mutation                                  | [PR #5](https://github.com/merkr-software/cadencr-registry/pull/5) / [39677672191](https://github.com/merkr-software/cadencr-registry/actions/runs/39677672191) | Both jobs rejected mutation of existing packages/submissions.                                                                       |
| Tampered candidate tooling and pin                         | [PR #6](https://github.com/merkr-software/cadencr-registry/pull/6) / [39677680370](https://github.com/merkr-software/cadencr-registry/actions/runs/39677680370) | Both jobs passed using trusted-base tooling/pin; candidate helper `exit 99` and pin `PENDING` were ignored; index construction ran. |

### Exact run bindings

| PR  | Candidate head                             | Trusted base                                                   |
| --- | ------------------------------------------ | -------------------------------------------------------------- |
| #3  | `e1503966405b41a6f9b20f3708314b6a256dd47f` | `bb19ac8be430672fce167541e5830f33c70968bc`                     |
| #4  | `627c8615d1ee46373ba523e8fd68019437d84db8` | `bb19ac8be430672fce167541e5830f33c70968bc`                     |
| #5  | `e4946b44a939cb6da71af13d07dae59500a9f1bf` | `e1503966405b41a6f9b20f3708314b6a256dd47f` (populated QA base) |
| #6  | `0ae08e092b58558d36f24c4434e329b0c41c5572` | `bb19ac8be430672fce167541e5830f33c70968bc`                     |

Hosted logs prove successful unsigned index construction from three-kind inputs.
No hosted index artifact was uploaded or independently inspected. The schema-2
file's exact three-kind count was independently inspected only in the local
native test; this is not a signed feed or official package publication.

## JavaScript retirement delivered — rechecked 2026-10-23

- PR #7 is merged at `8731ca0551e753b02f10297c6fdb66c65e78026b`, still the
  registry's remote `main` tip when rechecked. The tree has 24 files, no
  `.js`/`.mjs`/`.cjs` files and no npm manifest/lockfile. It retains inert
  compatibility fixtures, three shell acquisition/orchestration helpers and
  inactive protected-workflow examples; this is not a claim that all inline
  workflow scripting was removed.
- Post-retirement [run 39679587509](https://github.com/merkr-software/cadencr-registry/actions/runs/39679587509)
  passed both jobs for QA PR #8, head
  `d9e7e86ca218529cd600b2bc492572a603c65f84` against trusted base `8731ca0`.
  Provider, theme and UI-only-tab metadata reached unsigned index construction
  using the cleaned trusted-base tooling. PR #8 closed **without merge**.
- Production `packages/` and `submissions/` still contain only `.gitkeep`.
  The sole active workflow is contribution validation; protected publisher
  examples have not become active production workflows.
- This proof does not cover the subsequently merged native-tab backend contract
  or the newer stable CLI. Their acceptance gates are in the active plan.

## Explicit current governance

- Only `rle-mino` may push `main`; no teams or apps are allowed push actors.
- `enforce_admins` is `true`.
- No mandatory reviews and no mandatory CI checks; hosted CI runs advisory.
- This explicitly authorized policy supersedes earlier governance requirements.
  It does not relax package validation, immutable-byte or signing boundaries.

## Qualified executable and evidence boundaries

- The executable remains `0.13.1-dev.39306959010.1`, with the exact reviewed
  checksum and source bindings in the [frozen pin review](MARKETPLACE_CLI_PIN_REVIEW_2026-10-21.md).
- Existing distributed-binary proof remains in the
  [October 21 qualification](MARKETPLACE_RUST_CUTOVER_QUALIFICATION_2026-10-21.md).
  Its historical failure uncertainty is unchanged by this registry delivery.
- These orchestration changes need no new CLI or desktop release.
- Stable CLI `0.14.1` is now published, but the registry still pins the qualified
  dev executable above. Its independently downloaded checksum/provenance check
  and the SDK releases are recorded in the
  [October 23 plan update](MARKETPLACE_V1.md#independent-tool-releases-and-native-tab-delta--2026-10-23),
  not treated as new lifecycle qualification or automatic pin promotion.
- This record is maintained after registry delivery. It was not present in
  CLI source commit `646864caeca2896170baa65d5389b475099b2ce1`; a local documentation
  update is not itself evidence of public documentation delivery.

## Pending work and non-claims

- [x] Complete populated hosted provider/theme/tab validation, unsigned index
      construction, malformed-input and immutability rejection, and trusted-base
      tampering qualification, within the evidence boundaries above.
- [x] Deliver legacy JavaScript cleanup in PR #7 and recheck populated hosted CI
      after retirement. Root workflow cleanup removes two `setup-node` steps and
      tests reject the obsolete Node pin.
- [ ] Qualify/adopt stable CLI `0.14.1` and the expanded native-tab contract;
      existing provider/theme/UI-only-tab evidence remains scenario-specific.
- [ ] Publish reviewed immutable official Graphite, Ember, Fjord and Pi releases.
- [ ] Provision and verify production signing authority, signed feeds,
      renewal/revocation ownership and operating controls.
- [ ] Qualify supported packaged-client lifecycles before separate public
      desktop trust/feed/UI activation.

No official plugin release, production signing/feed publication or desktop
activation occurred as part of this delivery. See the active
[Marketplace V1 plan](MARKETPLACE_V1.md#current-registry-delivery-checkpoint--2026-10-23).
