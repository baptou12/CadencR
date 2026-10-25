# Stable CLI 0.15.0 qualification — 2026-10-25

> Qualification INCOMPLETE: twelve of thirteen gates passed on the exact distributed ELF. Gate 13 (revocation policy lifecycle) FAILED at the first provider bootstrap publication and was not completed. Monorepo pins must not be promoted to `0.15.0` on this evidence alone. See [Gate 13: failed](#gate-13-revocation-policy-lifecycle--failed).

## Binary and fixture provenance

| Binding                                      | Reviewed value                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distributed Linux ELF                        | `cadencr` `0.15.0`, asset `cadencr-v0.15.0-x86_64-unknown-linux-gnu`, `5985576` bytes                                                                                                                                                           |
| Released ELF SHA-256                         | `90b18bf95f3809b5735a272b9f7c089549c25629e115e99422dd4c770656fd15`                                                                                                                                                                              |
| Release tag                                  | `cli/v0.15.0` (`released-cli.env` asset: version `0.15.0`, tag `cli/v0.15.0`, the SHA-256 above)                                                                                                                                                |
| Released source commit                       | `f7dce47a637b055452822039163b03ce97cd02f4`                                                                                                                                                                                                      |
| Release run                                  | [40216356485](https://github.com/merkr-software/cadencr/actions/runs/40216356485) (attempt `1`, `provenance.json` binds source, tag, asset and digest)                                                                                          |
| Public inert fixture source — not CLI source | `c589553bc491c45f2063e40e77c5a1dee0be9708` (fixtures `1.0.5`; immutable tags `qa-author-cli/stable-0150-{provider,theme,tab}-20261025`)                                                                                                         |
| QA repository                                | `merkr-software/cadencr-registry-qa`, ID `1420296872`                                                                                                                                                                                           |
| Local helpers                                | Planning only, not qualification evidence: the macOS debug build and the same released ELF run under linux/amd64 emulation on the author machine (catalog authentication before use as `previous`; the runner re-authenticates it with the ELF) |

QA main commits, in order: `c589553` fixtures, `d9deff6` pins + provider candidate, `c150041` theme candidate, `be29d23` tab candidate, `95800ee` incremental, `e5ab6fc` renewal, `ec92712` policy lifecycle harness (final QA main).

## Twelve passed gates

All runs below are attempt `1` and concluded `success`. Proof digests are complete SHA-256 values of the uploaded proof JSON. Candidate commits are the workflow heads, not CLI source commits. Each author kind used one offline dispatch (`publish=false`), one public dispatch (`publish=true`, `interrupt_draft=true`, observed empty draft terminated and resumed on the same release ID) and one fresh dispatch (`publish=true`, `interrupt_draft=false`, `not_exercised`, same release ID, identical inventory). Every publication proof records two completed retries and `publication: verified`.

| Passed gate                 | Run                                                                                           | Candidate / reviewed commit                | Proof SHA-256                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| General offline (91 checks) | [40217054238](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40217054238) | `d9deff6fab76642317a1dcc80b91ca032afa77f8` | `d859ffb27bab8a802e7ccd26d0794f6d8aa813b460a0ccf61775d4cfd2112386` |
| provider offline            | [40217056875](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40217056875) | `d9deff6fab76642317a1dcc80b91ca032afa77f8` | `0049925f6a872a8a87667190c33c5b2a46f8174eba120e41cf3b90cdd9bedc1e` |
| provider public             | [40217083777](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40217083777) | `d9deff6fab76642317a1dcc80b91ca032afa77f8` | `f79338ec2e952872a5d9faf6d677ab0c4ac6e784912dabecb4fe091964e7bf3f` |
| provider fresh              | [40217208103](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40217208103) | `d9deff6fab76642317a1dcc80b91ca032afa77f8` | `b9558dd01b7c863dc55ede6895aef86799ede12c9bccf02e5e76b9336d75b8b2` |
| theme offline               | [40217328354](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40217328354) | `c15004128b5944f890331504e750df0b81b9a8d5` | `c59581235494686b32cd1832174a00a4d5482943373c9795a7eba8e015f0d379` |
| theme public                | [40217350299](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40217350299) | `c15004128b5944f890331504e750df0b81b9a8d5` | `aa8fddc27a9d1ffbb631f7dae37b22d46520d821aa90f14eee3a15f72855b2bc` |
| theme fresh                 | [40217417875](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40217417875) | `c15004128b5944f890331504e750df0b81b9a8d5` | `a2f1b30d6d5db450fbdb3f6eb25c597fbd89e5049582170674312b68be3b9b9a` |
| tab offline                 | [40217470695](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40217470695) | `be29d23a10cd5652f7de1b0f39ac23b754d203b2` | `6194dfe9a98d87a39d4f00f7363e89f6d8192c449363ca6cc3a1af5f25c04cb5` |
| tab public                  | [40217484353](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40217484353) | `be29d23a10cd5652f7de1b0f39ac23b754d203b2` | `dd66dcdc94d4c0f042a39661087ed78175511cd2200f3c6d695656c35daa9cb5` |
| tab fresh                   | [40217554794](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40217554794) | `be29d23a10cd5652f7de1b0f39ac23b754d203b2` | `f29eb94150f55e1b6e6ae59dffc78c9f6f8958a40729e7a566f1dee39522480c` |

The general offline run reports `status: passed`, `checks: 91`, `lifecycle_qualified: false` (offline-only by design), `production_pins_changed: false`.

Candidate JSON SHA-256 bindings and published author releases:

| Kind     | Candidate SHA-256                                                  | Author release ID |
| -------- | ------------------------------------------------------------------ | ----------------- |
| provider | `9cf8c413933b1ce21ffa563ecc6443c272d7af9cda3b90af537b13868e53e72f` | `423554651`       |
| theme    | `2563443798b2336c3e7ef4cc32998b62550088bb4123865a29e39449e4b48242` | `423556377`       |
| tab      | `1812698989988400b2044e9174da8023faef945a055312cb88c261792d8ecae6` | `423557235`       |

## Verified incremental and first-pass renewal

Both runs completed on attempt `1`. Each passed first publish, same-state replay, fresh-runner publish and fresh same-state replay with identical catalog/inventory within its phase. Renewal was a new first-pass run, not a delayed recovery. The `previous` catalogs were downloaded from the live discovery branch and authenticated before use: incremental baseline `71c451dd3cf9f073fc66ed38aac8f2f149e76f8f6febb5cc56cfbfa6f2d3c07b` (the 0.14.2 renewal catalog), renewal baseline `a52fc1ae8b61d94841c02c62c46d750c5bd4b8e31bede9519ef4504c095e4afb` (the incremental result). The runner re-verifies each baseline with the pinned ELF before publishing.

| Binding         | Incremental                                                                                   | Renewal                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Run             | [40217755517](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40217755517) | [40218166116](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40218166116) |
| Commit          | `95800ee87daf51cdd9032118deb84303010fb5f2`                                                    | `e5ab6fc90921bdb361fbc5d82d22edab4f02aba6`                                                    |
| Request SHA-256 | `8589a26ce8f59837bf27f953695c031db29942053f24031476dc3e741dc8f11c`                            | `9a30c8b3a81660c732fb7c651ce61428f236dcc1f8cb5e10972bccec7aa88879`                            |
| Plan SHA-256    | `322b37facbcc4d0c6749fec3fb8322b92498edb0d112f737e6f5087460f6af9d`                            | `8a09c0bede8aec53beba833058ac5e71e82ab698855c11f858c36b6fa7daa670`                            |
| Catalog SHA-256 | `a52fc1ae8b61d94841c02c62c46d750c5bd4b8e31bede9519ef4504c095e4afb`                            | `89cb2e3e5de7d9578f264da1aea4052a7d7b3cd573ee81b5865350ae5f83d0ff`                            |

| Phase / receipt                       | Proof SHA-256                                                      |
| ------------------------------------- | ------------------------------------------------------------------ |
| incremental / first/publish           | `0cf08e83c1c316fc00f7732b11cfb85b732d8929418fd8846e68b982eaa89860` |
| incremental / first/same-state-replay | `ca967e3c04088509b8ee7d13bc0d3f297a25dc3ec788ab39f810cb33141fc35c` |
| incremental / fresh/publish           | `626846e26efb4da386d4e9dc62c05e4dec758ede33dfa516a7a1c0743a88a9a2` |
| incremental / fresh/same-state-replay | `f2d7d3d85b1a6ad97a8364d329cf5ca7eebbf3632060d2c5b79ae2863634a0d2` |
| renewal / first/publish               | `a8afe96d571e13ebbe660fc4d0804729fff479fa207d9e70f09b186272f0e336` |
| renewal / first/same-state-replay     | `0ccf17f4ba8ccbf5eaaa01dcffe3c7e5d51cfd9fbf3eea26545cc7a48a34a694` |
| renewal / fresh/publish               | `24d52b04d192712857be6b215ec61ef92d2d552c4d95f95faa325a8fc8c07c9c` |
| renewal / fresh/same-state-replay     | `2a5a9342adab777b1c140be4285f33b52bc839dfe6e62fd7ffe5c9888efdab13` |

| Phase / runner      | Artifact ID   | Artifact ZIP SHA-256 (GitHub API digest)                           |
| ------------------- | ------------- | ------------------------------------------------------------------ |
| incremental / first | `12608103875` | `9cad897d12a767a5ea06760fc006ee1215f339e280831f0a9646a71f61996e16` |
| incremental / fresh | `12608049357` | `1cda5bf653e2363062144cc7477d8b9fb4c4609d4cbd67b9c18a4664aec6ce0a` |
| renewal / first     | `12607764813` | `7c00474cd7447f8212dcaab87f1ac81605b9681e4e0ca311344fd646e196a8f4` |
| renewal / fresh     | `12608044350` | `8565fc080427d2d243f853d5c5f93e4edcc346d035ab70b665a964d122d76f09` |

- Incremental advanced 17 → 20 entries and 28 → 35 archive URLs (mirror tags `provider-qa-author-provider-v1.0.5`, `theme-qa-author-theme-v1.0.5`, `tab-qa-author-tab-v1.0.5`). The three added-entry digests are `41e54c1fccd376cb068c32cc0d685c5a3706b5ad8bf82e9487ad8c8dfeecba06`, `8e741a641d2336ffb573493bdb65e42fe2a352522031866d17ef7ff7b280065c`, `f8ec31b5644e80da2165894af9d8db206571c13f41deebf5be2761c565b15e78`; the reviewed derivation was first checked by reproducing the qualified `1.0.4` entries byte-for-byte. Frozen window: `2026-10-25T17:40:00Z` → `2026-11-01T17:40:00Z`.
- Incremental first-run receipts attest the controlled interruption/resume checkpoint (`interruption_observed: true`); fresh-runner receipts correctly report no interruption. Post-run inventory: 57 releases, discovery head `d32c3db3dd…`.
- Renewal preserves the exact package sequence and 35-archive coverage with empty publications, inputs, mirror tags and added hashes. Frozen window: `2026-10-25T17:46:00Z` → `2026-11-01T17:46:00Z`. Post-run inventory: 58 releases, discovery head `d46a8ac461…`.
- Workflow artifacts authenticate retained receipt/catalog bytes; signature verification is attested by the distributed ELF workflow, not independently reexecuted by the collector.

## Gate 13: revocation policy lifecycle — FAILED

New workflow `policy.yml` (QA main `ec92712f605e56ea27fb65c3a946180176ec788c`): `workflow_dispatch` only, exact reviewed commit and `requests/stable-0150-20261025/policy.json` SHA-256 guard (`bcdd0c241ae19c4e8cf4df1ac69baf14a902e3d801900f55e448bb0013ed8698`) before any secret, pinned ELF from `cli-pin.env`, job permissions `contents: write` only, `QA_SIGNING_KEY_PEM` only in the run step, shared `registry-qa-lifecycle` concurrency group. Inert empty-entries payloads (`generated_at` `2026-10-25T17:30:00Z`, `expires_at` `2026-11-01T17:30:00Z`) for the provider, theme and tab policies; renewal expiry `2026-11-07T00:00:00Z`. Planned sequence: sign, verify, bootstrap, fetch baseline, renew, publish `--renewal`, replay must be `unchanged`, rollback must be refused, all with branch-head and blob comparisons.

| Item                     | Value                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run                      | [40218338622](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40218338622), attempt `1`, conclusion `failure`                                        |
| Failed step              | Provider `publish-policy --bootstrap` (sign and verify of all three kinds had already passed; their signed envelopes are in the artifact)                               |
| CLI diagnostic           | `REGISTRY_POLICY_PUBLICATION_FAILED`, message SHA-256 `64264beb095916d2441f582a04d5df950e89759a7576c8891903f74a15181aa9`                                                |
| Message identified as    | `policy does not contain the candidate` (SHA-256 matched against every string literal in the publisher and core crates; this is the only match)                         |
| Artifact                 | `12608338653`, ZIP `07d318874e3a35f145e25e1ab0037a276f3169396bd4c41bda1d520cdb145f68`                                                                                   |
| Branch state after       | `marketplace-v2` commit `8eab169141897b2e459bde3ca209f421d260cd58` ("Update managed provider revocation policy", `2026-10-25T17:49:59Z`) added `managed-blocklist.json` |
| Published provider bytes | SHA-256 `1d7048dd1545196ef4553c3d2d79b05089253d788d425502252ddb4672023f66`; identical to the run's signed bootstrap envelope; authenticates with the QA key             |
| Theme / tab policy files | Not published                                                                                                                                                           |

Diagnosis from the source of the distributed release (`publish_policy`, `write::set_or_reconcile`, `read_discovery_file`): the conditional write succeeded and landed, then the CLI's immediate single-shot authenticated read-back (ref, commit, tree, contents) did not return the file, so it failed with "does not contain the candidate" about two seconds after the commit time. That read-back has no bounded convergence, unlike the public-feed check that follows it. The most likely cause is GitHub API read-after-write lag on the branch ref. The harness cannot influence this read. It is a defect of the released CLI's policy publication path, not a harness fault, and it was not worked around: no retry wrapper, no deletion of the policy file and no branch reset was performed.

A read-only replay of the same signed provider bytes with the same ELF and a personal token (not qualification evidence) reported `Unchanged and public feed verified`, which confirms the final state is correct and that only the post-write read-back raced.

Consequences for the record:

- Bootstrap, renewal publication, replay idempotence and rollback refusal were NOT exercised on the released ELF. Gate 13 is not passed. No success is claimed for any `publish-policy` or `fetch-policy` behavior.
- The provider policy is already live on the QA discovery branch from this failed attempt; `--bootstrap` is refused for it by design, so the failed run cannot be repeated unchanged on `marketplace-v2`.
- Sign/verify of all three policy kinds worked on the runner before the failure (envelopes retained in the artifact).

## Preserved failures and inventory

- Policy run `40218338622` above is preserved as failed. It is not relabeled and no replacement run exists yet.
- No other run failed. No author, catalog or renewal run needed a rerun; all production state is untouched.
- The QA discovery branch gained, from this qualification: the catalog generations `a52fc1ae…` and `89cb2e3e…`, and the single `managed-blocklist.json` policy file.

## Scope and exclusions

- Public disposable QA fixtures only; no production marketplace activation. Nothing in `merkr-software/cadencr-registry` was touched. Monorepo pins were not changed.
- Native archive validation/target matrix is not native fixture execution, backend conformance, managed installation, or client/UI QA. None of those are claimed.
- Source/macOS planning helpers, emulated local runs and synthetic local tests are not released-ELF qualification evidence.
- The older 0.14.2 record remains separate: [the 2026-10-25 stable CLI 0.14.2 evidence](MARKETPLACE_STABLE_CLI_2026_10_25.md).
- Harness notes: `scripts/harness.test.mjs` in the QA repo still asserts the 0.13.1 development pin and fails locally (pre-existing since earlier pin bumps; not run in CI). `scripts/author-cli-qa/test_harness.py` needs Python 3.11+ (`fromisoformat` of `Z`); the runner uses it and passes.
- Tokens and signing material were never printed or committed. This record was assembled from retained run artifacts and the GitHub API on 2026-10-25.
