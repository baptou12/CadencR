# Rust-only CLI cutover qualification — 2026-10-21

## Scope and exact executable

This record extends, rather than replaces, the [October 18 evidence](MARKETPLACE_RUST_CUTOVER_QUALIFICATION_2026-10-18.md).
It records actual distributed-binary checks against the approved isolated public
QA repository. It does not qualify desktop installation or plugin execution.

| Binding              | Value                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| CLI                  | `0.13.1-dev.39306959010.1`                                                                                    |
| Source commit        | `646864caeca2896170baa65d5389b475099b2ce1`                                                                    |
| Linux x86-64 SHA-256 | `251c5d0cc7120ccc44dc2d8ad473bd5bb31e3577542098feb72f31372ed7b88a`                                            |
| Asset                | `cadencr-v0.13.1-dev.39306959010.1-x86_64-unknown-linux-gnu`                                                  |
| Delivery             | [CLI-only development release](https://github.com/merkr-software/CadencR/actions/runs/39306959010)            |
| Release assets       | [Immutable release tag](https://github.com/merkr-software/CadencR/releases/tag/cli/v0.13.1-dev.39306959010.1) |
| QA target            | `merkr-software/cadencr-registry-qa`, repository ID `1420296872`                                              |

The executable, `SHA256SUMS`, `provenance.json` and `released-cli.env` were
downloaded and their checksum/provenance/tag/source bindings verified. Hosted
qualification executes the downloaded ELF, not a source-built substitute; the
local binding inspection did not execute it. Source preparation and native
expectation generation alone are not distributed-binary evidence.

Canonical source [CI](https://github.com/merkr-software/CadencR/actions/runs/39305419666),
[CodeQL](https://github.com/merkr-software/CadencR/actions/runs/39305419600) and
[dependency audit](https://github.com/merkr-software/CadencR/actions/runs/39305419605)
preceded the release. Relevant crate changes since this source are manifest
version changes only; that does **not** qualify a current `0.14` release binary.

## October 19 networkless and first-pass renewal proof

[Networkless run 39307730636](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39307730636)
passed **65 checks**, including all three package kinds and Rust standalone
metadata/submission/expiry diagnostics. Its proof SHA-256 is
`10cd5f2b7f31232204bc4c7cdd855ce1bf20df560e39e1d2787278a4a2734b35`.
Offline checks do not establish hosted publication or runtime behavior.

[Renewal run 39307825181](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39307825181)
passed on its **first attempt**, then passed same-state replay and separate
fresh-runner reconstruction/replay: four verified proofs, **8 entries and 10
archives**, with unchanged inventory across replays. Operation commit:
`314f6029bd3d8740982f8f2c3e10d5734b00594b`.

| Binding         | SHA-256                                                            |
| --------------- | ------------------------------------------------------------------ |
| Renewal plan    | `546dc44b7a1fdef88edd116589bba9e6233f44e834491aa6f7b68d1fec93d2e8` |
| Renewal request | `20cadeedfd035bb10d0439ba7b01efb78fc27e2018a35a326c9b09ad07b875e0` |
| Renewed catalog | `e9fc56363d8d39e3bc77b2d5e2004905e696b021f7463d93c586e9dac4e35bef` |

The historical [failed renewal 39147214594](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39147214594)
remains failed; its exact cause is unknown. The [original-intent recovery 39147499709](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39147499709)
is recovery evidence, not first-pass success. Neither the source convergence
correction nor later success retroactively establishes the historical cause.

## October 21 original-author lifecycle: all three kinds

New immutable QA versions `1.0.2` preserve earlier versions. All nine runs below
have collected, verified proofs bound to the exact CLI version and checksum above.

| Kind     | Offline inspection/rejection                                                                  | Public interruption/resume/retries                                                            | Separate fresh runner                                                                         |
| -------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Provider | [39647519039](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39647519039) | [39647575960](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39647575960) | [39647717467](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39647717467) |
| Theme    | [39647830099](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39647830099) | [39647890589](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39647890589) | [39648028016](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39648028016) |
| Tab      | [39648140757](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39648140757) | [39648196822](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39648196822) | [39648336135](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39648336135) |

- Offline runs inspect locally and reject incorrect confirmation; they do not
  request publication or exercise interruption.
- Each public run observes an **empty remote draft**, terminates its owned CLI
  process, resumes with the same release ID, verifies public asset bytes and
  completes two exact retries. This is not arbitrary lost-response recovery.
- Changed bytes and changed requests are rejected with unchanged remote inventory.
  Each independent fresh runner repeats the same content-bound request without
  restored state and preserves the original release/asset identities.
- The provider is inert, **not Pi**. Its two platform archives do not prove native
  execution on either target. The tab is a static UI-only fixture; no custom-tab
  runtime, consent or desktop behavior was exercised. Themes were not activated.

### Immutable author request bindings

| Kind     | Request SHA-256                                                    | Release ID  |
| -------- | ------------------------------------------------------------------ | ----------- |
| Provider | `772074441a2b304cb6748cb25e7446bf9ae08e79ac33b4892bdd8d0618f43530` | `419874315` |
| Theme    | `444db4d65250bb26a23d692e5a33b84ba5596ee601b6c2d3d48817aa418336f3` | `419876286` |
| Tab      | `3b9a4e4c305d7bd792aaf8a415953547ed2d335bf3416459ef9f45d6d4289452` | `419878242` |

## Mixed incremental publication: verified

[Run 39648931506](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39648931506)
passed with **11 entries and 14 archives**: the eight earlier entries remain
unchanged and the three new immutable `1.0.2` versions are included. The controlled
interruption occurs after the theme mirror becomes public. Same-state resume and
replay plus separate fresh-runner reconstruction/replay produce four verified
proofs with identical complete release/asset inventories.

| Binding          | Value                                                              |
| ---------------- | ------------------------------------------------------------------ |
| Operation commit | `a8e01586a3b6b8dadc6818526a5e5963f213efb2`                         |
| Plan SHA-256     | `e906c269c4bb124e62b514ea2daed13ae9a06dab6b507d8e5e77fdbc384e1559` |
| Request SHA-256  | `8fd354d73b994af8431326a28bc3b6acc06e5d95dd7148ea09c9ee8f87193caf` |
| Catalog SHA-256  | `eb255d333cf0f90c409ba0749c040dc4ff4ab83732e74fc131ed74ade2617490` |

## New-catalog first-pass renewal: verified

[Run 39649923656](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39649923656)
passed first-pass renewal of the **11-entry / 14-archive** catalog, followed by
same-state replay and separate fresh-runner reconstruction/replay. All four
proofs, signed indexes and complete inventories were independently cross-checked;
inventory remains identical across those replays. No failed-job retry, recovery
of a failed renewal or replacement source dates supplied this result.

| Binding          | Value                                                              |
| ---------------- | ------------------------------------------------------------------ |
| Operation commit | `c719d96b790966a6ae8941ee7bdfc6b6cee12a95`                         |
| Plan SHA-256     | `d62f59090bd05c3ee2369b720470b54f8f9d424012dda0844ca4868e053ae9a3` |
| Request SHA-256  | `505185a9f1bd0413f09518166b525c3d340551bc9de5c0e62ec129cf276b481d` |
| Catalog SHA-256  | `ab09aa938789efbbf15565ea1a61db07631f6d209692b0751f99a692fe53823a` |

## Delivery boundaries and remaining approvals

- Existing production and source-candidate executable pins remain unchanged.
  QA pinning or a development CLI release is not production deployment.
- Registry/author pin promotion, rebuilt bootstrap/cutover payload hashes and
  renewed approvals remain required before delivery; old byte approvals cannot
  authorize changed payloads.
- No production registry/authority/feed mutation, official Pi/theme publication,
  desktop release or public marketplace UI activation occurred.
- Consumer install/use/update/restart/remove, Pi ACP behavior, supported native
  runtime matrix, revocation operations and packaged-client acceptance remain
  separate gates in the [delivery plan](MARKETPLACE_V1.md#remaining-delivery-waves--2026-10-21).
