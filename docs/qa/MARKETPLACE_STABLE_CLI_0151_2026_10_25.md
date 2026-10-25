# Stable CLI 0.15.1 qualification — 2026-10-25

> Qualification complete: all thirteen gates passed at run time on the exact distributed ELF, after two preserved failed attempts (first-pass renewal and the first policy-lifecycle run on the fresh branch), both caused by the raw CDN serving the previous body longer than the CLI's bounded 30 s convergence budget. Monorepo pins have not been changed by this record; the deployed registry pin and production readiness remain separate gates.

## Binary and fixture provenance

| Binding                                      | Reviewed value                                                                                                                                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distributed Linux ELF                        | `cadencr` `0.15.1`, asset `cadencr-v0.15.1-x86_64-unknown-linux-gnu`, `5992592` bytes                                                                                                                                              |
| Released ELF SHA-256                         | `466b7b6c3be2e2092b5b79264c204cd7ad987da58b8b0d403cc47634406a6199`                                                                                                                                                                 |
| Release tag                                  | `cli/v0.15.1` (`released-cli.env` asset: version `0.15.1`, tag `cli/v0.15.1`, the SHA-256 above)                                                                                                                                   |
| Released source commit                       | `5f2bbd35ad9b72e7c65bc74a17421cff31844a80`                                                                                                                                                                                         |
| Release run                                  | [40224126294](https://github.com/merkr-software/cadencr/actions/runs/40224126294) (attempt `1`; `provenance.json` binds source, tag, asset and digest)                                                                             |
| Public inert fixture source — not CLI source | `dfe04d5d7d797a97b28b35aa5038f0728a3df768` (fixtures `1.0.6`; immutable tags `qa-author-cli/stable-0151-{provider,theme,tab}-20261025`)                                                                                            |
| QA repository                                | `merkr-software/cadencr-registry-qa`, ID `1420296872`                                                                                                                                                                              |
| Local helpers                                | Planning only, not qualification evidence: the same released ELF run under linux/amd64 emulation on the author machine to authenticate downloaded catalogs before use as `previous`; the runners re-authenticate them with the ELF |

QA main commits, in order: `dfe04d5` fixtures, `985a17e` pins + provider candidate, `cee397b` theme candidate, `2ae9d1d` tab candidate, `336109a` incremental, `1d8246f` renewal (failed attempt), `7b660e7` renewal (rerun), `7a5eeaa` policy lifecycle bound to 0.15.1 (failed attempt), `b50242b` policy lifecycle with settle delay (final QA main).

## Ten verified offline and author gates

All runs are attempt `1` and concluded `success`. Proof digests are complete SHA-256 values of the uploaded proof JSON. Candidate commits are the workflow heads, not CLI source commits. Each author kind used one offline dispatch (`publish=false`), one public dispatch (`publish=true`, `interrupt_draft=true`: observed empty draft terminated and resumed on the same release ID) and one fresh dispatch (`publish=true`, `interrupt_draft=false`, `not_exercised`, same release ID, identical inventory). Every publication proof records two completed retries and `publication: verified`.

| Passed gate                 | Run                                                                                           | Candidate / reviewed commit                | Proof SHA-256                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| General offline (91 checks) | [40224568022](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40224568022) | `985a17e20c6d1c7a6ad0d2e3d21a27351cd41f56` | `295e862197f66952c4d021d5f9ecbf6820a5f7d2bd903f7c064aa669ff150a59` |
| provider offline            | [40224591580](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40224591580) | `985a17e20c6d1c7a6ad0d2e3d21a27351cd41f56` | `25f9510ac010df611071f62804b8b82ad270bedc434edd520e20ada468868d0f` |
| provider public             | [40224606926](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40224606926) | `985a17e20c6d1c7a6ad0d2e3d21a27351cd41f56` | `0490c3073dbf1a077caf96e5931c5b0abe06efc5ca112f16f2fe3d27fc253994` |
| provider fresh              | [40224665062](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40224665062) | `985a17e20c6d1c7a6ad0d2e3d21a27351cd41f56` | `42a0a00caefddc181e3c1c8e336310dcc4e6039e7d317ad2a8fe37185d7b31ee` |
| theme offline               | [40224707559](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40224707559) | `cee397b10233cc0e1eef60da69a0961dd7233025` | `037d316d5568e095f18323cd1b91e86c2f0a8580cece1d57fba55d4823f79f49` |
| theme public                | [40224729960](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40224729960) | `cee397b10233cc0e1eef60da69a0961dd7233025` | `8fe841b7c61bc0218690cbf429ce9304bb4b979ad3cb889e8c3d6fd5d532d1c7` |
| theme fresh                 | [40224794574](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40224794574) | `cee397b10233cc0e1eef60da69a0961dd7233025` | `2e687e217583dcc749f17a50871203a8c8c34e960fab2e90d5e652867236896e` |
| tab offline                 | [40224847691](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40224847691) | `2ae9d1d68cd015896b424d89917ed22fa40a224e` | `981d5273e24bf44fbb1f34f87767c02ff595f3db0ea0bcbcf45b68099de9cfbc` |
| tab public                  | [40224869415](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40224869415) | `2ae9d1d68cd015896b424d89917ed22fa40a224e` | `4eba441829f364a8448a0d43730d61e7e5f30387fecb7ce8ea2c6a30500f78ab` |
| tab fresh                   | [40224928519](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40224928519) | `2ae9d1d68cd015896b424d89917ed22fa40a224e` | `cb728e26834ada36e262de8cab3b87a4f67e8131a751e3a167af084d96872236` |

The general offline run reports `status: passed`, 91 checks, `lifecycle_qualified: false` (offline-only by design) and `production_pins_changed: false`.

Candidate JSON SHA-256 bindings and published author releases:

| Kind     | Candidate SHA-256                                                  | Author release ID |
| -------- | ------------------------------------------------------------------ | ----------------- |
| provider | `c9127d6da49b0aaf8cf23f35d782706eeccafdd48566e5d0ac10d85c301890b3` | `423603913`       |
| theme    | `44085a3776c9bca08abf88187cc2ad17e24d843e677e4f57d3c62082ea275632` | `423604685`       |
| tab      | `92abc5e1f638b927ae8922223e0cc09ad2b6f3afac731f2d923e1e67f6d7490d` | `423605450`       |

## Verified incremental and first-pass renewal

Incremental passed on attempt `1`. Renewal did NOT pass first time: the first renewal run failed (see the preserved failure below) and a second, separately reviewed renewal request passed on attempt `1`. Each passing run did first publish, same-state replay, fresh-runner publish and fresh same-state replay with identical catalog/inventory within its phase. The `previous` catalogs were downloaded from the live branch and authenticated before use: incremental baseline `89cb2e3e5de7d9578f264da1aea4052a7d7b3cd573ee81b5865350ae5f83d0ff` (the 0.15.0 renewal catalog), renewal-rerun baseline `cf90ae76d17ff80144645096ac78a818a01b0fe637c461cd4b749c07e31271e3` (the catalog the failed renewal had written). The runner re-verifies each baseline with the pinned ELF before publishing.

| Binding         | Incremental                                                                                   | Renewal (rerun)                                                                               |
| --------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Run             | [40225047559](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40225047559) | [40226017033](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40226017033) |
| Commit          | `336109a25a91a0b314cd0bf27e3e8cddb502679b`                                                    | `7b660e7562a4910a8d120288159feb70bd0ff366`                                                    |
| Request SHA-256 | `f07c5fd66df81b54c60f8274b91dd0a0fd387fa6b474faab561a0fcffb6520a3`                            | `10d29b606dac65fb1e79cac285f54bd538f527ebf6197fc8b4f49c7ac6986c61`                            |
| Plan SHA-256    | `881ed3c629ac6f8ba2d50c712312eb73aec214b76e7052d39c663a16b38ee2c3`                            | `9ca0affa362c8ef7270b18866d703b50e87e8c321c2905cecd0f41fae7f14f47`                            |
| Catalog SHA-256 | `1204a8f0cbac5c79c6635e2e2e96dc297341d4ed4de8b894a98c66491b81f63e`                            | `0688802d96060175794dcb87cb7d672a0bc70fd08fba01d4176b31e40bcbb143`                            |

| Phase / receipt                       | Proof SHA-256                                                      |
| ------------------------------------- | ------------------------------------------------------------------ |
| incremental / first/publish           | `927f33ba1f1c0f5e51efa7a25b0a242009c6afa61346f68cb13ee2b24d560b4d` |
| incremental / first/same-state-replay | `8a901a5f0ed14b6fdfde3200236f8bebf7823964d7b95285dc3b5a1a5754d845` |
| incremental / fresh/publish           | `4cd16766bb943c7d622943664c3ebe677251502c6f18f8bb7cef679ca4bdfda2` |
| incremental / fresh/same-state-replay | `11ac66b46e638d47344ff50ecd2122c3c8b50fc5d67363a88ec05a2716707831` |
| renewal / first/publish               | `373441ce74463209e1cc2c2d2496df852725aaae26028032bc83823966467dd3` |
| renewal / first/same-state-replay     | `7b9a07546050e048b9be52575f9ce5c31038e135a61d4f74afe357eaab500f06` |
| renewal / fresh/publish               | `7d6b5e1beaa451d1e887a852c5dbbebf65848cb3440fb46a7720674ba18b3807` |
| renewal / fresh/same-state-replay     | `15a4bfb1a77b461248a29db1edf4b8729ef8757fc05731a5672ecb119b66d433` |

| Phase / runner      | Artifact ID   | Artifact ZIP SHA-256 (GitHub API digest)                           |
| ------------------- | ------------- | ------------------------------------------------------------------ |
| incremental / first | `12611440785` | `d4386bd8823664625c2b2843d1ac92d2fd4186021190a8b50bb3b5c20d8c2980` |
| incremental / fresh | `12611500650` | `ee6e67687722c710e1b1a6876e9ff5ad9efc16e3774cf826bad7c05eefdd908d` |
| renewal / first     | `12611237700` | `7f54a9232e54ec9f0f16cf9da3c3acf742d22d508d55cb678df43c1a16840f76` |
| renewal / fresh     | `12610839058` | `1af105b324129b565433d2abead1581fbc64c910845da3f2bcf4822a92e38cc8` |

- Incremental advanced 20 → 23 entries and 35 → 42 archive URLs (mirror tags `provider-qa-author-provider-v1.0.6`, `theme-qa-author-theme-v1.0.6`, `tab-qa-author-tab-v1.0.6`). Added-entry digests: `994ed02d4def27cb8251f6b1d586e9576297eb60b4d50a1696a0420002ef4ec0`, `ce2b84fb853647f1be9189c74ca44bae37a5ce9e58ae18e87cc55051a5387ee4`, `ebd6b5d1638734a3cba7c3f3eeedfa45737832c46dead902c3ff9ec34af945b4` (derivation first reproduced the qualified `1.0.5` entries byte-for-byte). Frozen window `2026-10-25T19:10:00Z` → `2026-11-01T19:10:00Z`. Post-run inventory: 65 releases.
- Incremental first-run receipts attest the controlled interruption/resume checkpoint (`interruption_observed: true`); fresh-runner receipts correctly report no interruption.
- Renewal rerun preserves the exact package sequence (23 entries) and 42-archive coverage with empty publications, inputs, mirror tags and added hashes. Frozen window `2026-10-25T19:25:00Z` → `2026-11-01T19:25:00Z`. Post-run inventory: 67 releases (including the catalog release written by the failed renewal).
- Workflow artifacts authenticate retained receipt/catalog bytes; signature verification is attested by the distributed ELF workflow, not independently reexecuted by the collector.

## Gate 13: revocation policy lifecycle — passed

Workflow `policy.yml` (QA main `b50242b7ecc09e5efd66dc6fce68f7db32f0ae70`): `workflow_dispatch` only, exact reviewed commit and `requests/stable-0151-20261025/policy.json` SHA-256 guard before any secret, pinned ELF from `cli-pin.env`, job permission `contents: write` only, `QA_SIGNING_KEY_PEM` only in the run step, shared `registry-qa-lifecycle` concurrency group. Policies are QA-only, inert (empty entries) and published to a fresh QA-only branch `qa-policy-0151-r2` created from the reviewed harness commit. The stale provider policy left on `marketplace-v2` by the failed 0.15.0 run was not touched. Payload window `2026-10-25T19:05:00Z` → `2026-11-01T19:05:00Z`; renewal expiry `2026-11-07T00:00:00Z`; reviewed `cdn_settle_seconds: 330` between bootstrap and renewal.

| Item                     | Value                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Run                      | [40226355913](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40226355913), attempt `1`, `success`                          |
| Commit / request SHA-256 | `b50242b7ecc09e5efd66dc6fce68f7db32f0ae70` / `d802c83f8aeee538e892d29c6a2b9ea5cc44638133c3728ae31eacca09592961`                                |
| Proof SHA-256            | `30b6d419940099a2a656efbc519e7a09fb57828206f2fb627ab0fd459d824869`                                                                             |
| Artifact                 | `12611635549`, ZIP `373e80b14dedcb5fd339678e27c0b258d5cd59acf7c5b0038af4e47fdc067b34`                                                          |
| Branch heads             | start `b50242b7ec…`; after bootstrap `afc2aa9620…`; after renewal, replay and rollback attempts `b57eda53c5…` (no write by replay or rollback) |
| Catalog / releases       | `marketplace-v2` catalog `0688802d…` unchanged; 67 releases unchanged                                                                          |

| Policy   | Signed bootstrap SHA-256 (verified, bootstrapped)                  | Renewed SHA-256 (renew-policy from fetch-policy baseline; `advanced`) | Renewed `generated_at` |
| -------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------- |
| provider | `00c54ba1f6d389bd76cef8c7314274f52605690260ff74ace37ee004f9677e3b` | `4e22810c928307e77264cc0a9ea412ef5b533dc751a72629bda55aa794e969e5`    | `2026-10-25T19:36:25Z` |
| theme    | `b315e60f038bfbf2387c7983060c585dd657037181ec023c53f20128b6a26ff9` | `1e6a90f0c3c559b208b7f753b07216673c64323f048cfb5c081de5b9fcde18a3`    | `2026-10-25T19:36:26Z` |
| tab      | `e845ed5fc48c996a4768bdaf75ebac8c3ac25169b1565f62754f22ff0d8ce9cf` | `ae8619b818c1a090fc8534f395b34337344ed815e07cca87f977496177cbca72`    | `2026-10-25T19:36:27Z` |

For all three kinds the retained proof records: sign and verify passed; bootstrap receipt `bootstrapped` / `policy_verified` with an anonymous raw read equal to the signed bytes; `fetch-policy` baseline byte-equal to the bootstrap; `renew-policy` output verified with identical entries, newer `generated_at` and the reviewed expiry; `--renewal` publication `advanced` with `previous_sha256` equal to the bootstrap digest; replay of the same renewal `unchanged` with an identical branch head; republishing the older bootstrap policy refused with `REGISTRY_POLICY_PUBLICATION_FAILED` ("rollback refused", exit status 1) both plain and with `--renewal`, with branch head and blob SHAs unchanged; a final `fetch-policy` equal to the renewed bytes.

## Preserved failures and inventory

All failures below are preserved as failed attempts, not relabeled. Both are the same class: the CLI wrote correctly, then its public raw read-back saw the previous body for the whole bounded 30 s budget and failed closed with `public discovery: convergence read budget exhausted` (message SHA-256 `986f0900858890a62c1484e17577aaf934b48ea7185335d83479325e7a592818`, classified `discovery_convergence_exhausted`). `raw.githubusercontent.com` serves `cache-control: max-age=300`; both failures followed a read of the previous body by the same or a preceding run within five minutes.

- First renewal [40225480649](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40225480649) (commit `1d8246f903e6344a11d0e1d22277951910083cac`, request `d11e94cb96824b0b9000793c5450d6c8ab7a3f07126d2d57e1a4bc8fad76ac37`, plan `d057e1c8b626c2e0173d1fc88831f7779e59260669c033e83886d280d2899145`), attempt `1`, `failure`, started about three minutes after the incremental run. It wrote the renewal catalog `cf90ae76d17ff80144645096ac78a818a01b0fe637c461cd4b749c07e31271e3` (`2026-10-25T19:17:00Z`) to `marketplace-v2` before failing; the fresh job was skipped and no artifact was uploaded. That written catalog was authenticated and used as the baseline for the rerun, which was dispatched after waiting out the CDN lifetime (`19:26Z`). The rerun is a separate request, not a relabeling of this run.
- First 0.15.1 policy run [40226193870](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40226193870) (commit `7a5eeaa82b3d13db41c2b1f06d3f3ac6bfd0bd4e`, request `046fc638c012cefd51f95e5c6cf3aeb3476d0dd041b404d4dad8e0e1ba3fc891`), attempt `1`, `failure`, on branch `qa-policy-0151`. Sign, verify and all three bootstrap publications passed, which exercises the 0.15.1 authenticated read-back fix that failed in 0.15.0. Provider `--renewal` publication, seconds after bootstrap, then hit the CDN convergence timeout (artifact `12611073470`, ZIP `7c0e63606a2fc1630ddae9c9f647ef7509a114c23467920c5d1a9ae8c6cfdcf6`). Branch `qa-policy-0151` was left as is (three bootstrapped policies, provider renewed) and was not reused. The harness fix (a reviewed 330 s settle delay and a new fresh branch `qa-policy-0151-r2`) is a separate reviewed commit; the passing run above is the replacement.
- Earlier 0.15.0 failures are recorded separately in [the 0.15.0 evidence](MARKETPLACE_STABLE_CLI_0150_2026_10_25.md); that record's `marketplace-v2` `managed-blocklist.json` remains untouched.
- No author run needed a rerun. No release was removed or modified.

## Scope and exclusions

- Public disposable QA fixtures only; no production marketplace activation. Nothing in `merkr-software/cadencr-registry` was touched. Monorepo pins were not changed by this work.
- The QA branch `qa-policy-0151` and `qa-policy-0151-r2` are QA-only policy fixtures. The CDN-lifetime constraint (a renewal published within five minutes of the previous write can fail closed with `discovery_convergence_exhausted` although the write landed) is a property of the 30 s convergence budget against the 300 s raw cache, observed twice here; it is not a controlled stress test of the CDN.
- Native archive validation/target matrix is not native fixture execution, backend conformance, managed installation, or client/UI QA. None of those are claimed.
- All qualification evidence is the Linux x86_64 ELF on GitHub runners. No macOS-specific behavior was exercised; macOS and Linux client behavior still need separate platform validation.
- Source/macOS planning helpers, emulated local runs and synthetic local tests are not released-ELF qualification evidence.
- Tokens and signing material were never printed or committed. This record was assembled from retained run artifacts and the GitHub API on 2026-10-25.
