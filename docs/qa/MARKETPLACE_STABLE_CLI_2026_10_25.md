# Stable CLI 0.14.2 qualification — 2026-10-25

> Qualification complete: all twelve gates passed at run time on the exact distributed ELF. Monorepo pins were promoted to `0.14.2` on 2026-10-25; the deployed registry pin and production readiness remain separate gates.

## Binary and fixture provenance

| Binding                                      | Reviewed value                                                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distributed Linux ELF                        | `cadencr` `0.14.2`, `5899736` bytes                                                                                                                                   |
| Released ELF SHA-256                         | `1a2c28a13009c303e01148fe87b54fa77936bcfbe3947c51db918cbae5477849`                                                                                                    |
| Released source commit                       | `7bd611a0d10bfd161bb71f0f87ad693313b2c24f`                                                                                                                            |
| Release / dry-run                            | [40173885630](https://github.com/merkr-software/cadencr/actions/runs/40173885630) / [40173638696](https://github.com/merkr-software/cadencr/actions/runs/40173638696) |
| Public inert fixture source — not CLI source | `7f5c5872a6c9695cd2d5a0f970a4e3026e311621`                                                                                                                            |
| QA repository                                | `merkr-software/cadencr-registry-qa`, ID `1420296872`                                                                                                                 |
| Exact-tag macOS source helper                | Planning only; not distributed qualification; SHA-256 `782499b5fe41fbcde50095f136f43e9bf873d232c16862c731b671a1bf5c0522`                                              |

## Ten verified offline and author gates

Retained offline and author ledgers bind proof, candidate and successful run metadata. All author runs below are attempt `1`. Proof digests are complete SHA-256 values; candidate commits are the workflow heads, not CLI source commits.

| Passed gate                 | Run                                                                                           | Candidate / reviewed commit                | Proof SHA-256                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| General offline (91 checks) | [40175787615](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40175787615) | `ea542b484233a4556ae6a24713c9c8669831f9b9` | `67d7db5316b52bebe45899b2e8862b5d4303e9957a7e803e4747a48417b1db79` |
| provider offline            | [40175789373](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40175789373) | `ea542b484233a4556ae6a24713c9c8669831f9b9` | `8caa8e1e8a2c3c32b115a3efd02694c5059d80c3b8757c9418af0611988852d1` |
| provider public             | [40178072265](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40178072265) | `ea542b484233a4556ae6a24713c9c8669831f9b9` | `3dfd731b27fbe4ed7c58157acf56e5bb769a31340479df1b97a91cd210f08271` |
| provider fresh              | [40178318855](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40178318855) | `ea542b484233a4556ae6a24713c9c8669831f9b9` | `19469250678be43470dddf268c103d159f354cfe7d6e8647d026a971e7fc879f` |
| theme offline               | [40178641640](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40178641640) | `f058a81dd6839581bfd9c36d18a6eb500df6aed1` | `6eaff0278f1c7e97d0cc8f818ab8f26a34253c589418610c3be7a966831a957e` |
| theme public                | [40178858456](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40178858456) | `f058a81dd6839581bfd9c36d18a6eb500df6aed1` | `4ee5dfb31e8c028d2c085a24346f5b603a7bc3b0c1da417d3722fc46ea70fe93` |
| theme fresh                 | [40179111952](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40179111952) | `f058a81dd6839581bfd9c36d18a6eb500df6aed1` | `4a496778cad2a804dfe31c69479ebd35fc0a8fdbbc1c0f7722857834a116b156` |
| tab offline                 | [40179509856](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40179509856) | `d49aa3d23ab624a8ed4df29dd4f7926c77fe7c8b` | `527fd6f4e7e67d4b3227adab9d6b9eb60b9fcd6c9039dd876902a8d04ca698d8` |
| tab public                  | [40179554441](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40179554441) | `d49aa3d23ab624a8ed4df29dd4f7926c77fe7c8b` | `dc0691f173cdd518acfcaeb431c55348b7fb3a793d985e241dc90295e51a905b` |
| tab fresh                   | [40179676730](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40179676730) | `d49aa3d23ab624a8ed4df29dd4f7926c77fe7c8b` | `76600e63f57bc2209eee97bed35aa2911ebb41f33b3ca286e88c81057ae69483` |

Candidate JSON SHA-256 bindings:

| Kind     | Candidate SHA-256                                                  |
| -------- | ------------------------------------------------------------------ |
| provider | `030208810d3157473cc242b6399bf6b0c7d78b1475473c6cb049e652c36bbca4` |
| theme    | `d39eacf7f21c947e3aa3fa9cc4dd1935f0069bdcbb8282077a710a6e3523a282` |
| tab      | `1b2933ce65867361dc88796ee64501072367884ccab597417042b721542845ca` |

## Verified incremental and first-pass renewal

Both runs completed on attempt `1`. Each passed first publish, same-state replay, fresh-runner publish and fresh same-state replay with identical catalog/inventory within its phase. Renewal was a new first-pass run, not a delayed recovery; no incremental local state/artifact restoration was used.

| Binding         | Incremental                                                                                   | Renewal                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Run             | [40179940750](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40179940750) | [40180398957](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40180398957) |
| Commit          | `4d90167445e5dbfb68856a49c92179eee77d135f`                                                    | `25bc659e90932e2a9a0728026cb3e08a25701799`                                                    |
| Request SHA-256 | `6f48259ec99eb593b8bef73bcc0e4bd621513056bcd012cc71582e8a1347890b`                            | `116749f32191aebff105a004324ed9bbceb9443b20e1608ce2904da29a5090fa`                            |
| Plan SHA-256    | `fedd8fab0af734c5524b46f41a18a6dbec49aa2d75e1bdb4deebad2fde5ed2d0`                            | `12c08caa17bf0e6ff4e90c55d0e3b24df06bd3388329e5003b2ad1b69cf46f6d`                            |
| Catalog SHA-256 | `5690c23d8234d492df1d273263acad89dc083028fe4edaa53c8294ab34b612ba`                            | `71c451dd3cf9f073fc66ed38aac8f2f149e76f8f6febb5cc56cfbfa6f2d3c07b`                            |

| Phase / receipt                       | Proof SHA-256                                                      |
| ------------------------------------- | ------------------------------------------------------------------ |
| incremental / first/publish           | `8d3f529dc0e1f810497fa5f0c28268f428637530bd19fb94f00ecc9df8b791fe` |
| incremental / first/same-state-replay | `f8d3aa0dee22c23b475565a8009fd01b514dc44ceb86ffe43960f403c49f851a` |
| incremental / fresh/publish           | `bf68c7de52cead7cc7b07bbb31bdd150fc28c40c380a12c00432bdbba20261f6` |
| incremental / fresh/same-state-replay | `815119d22583e172565fc322bb3eb0899a38d32a82abf3ae8c1b6376352a6584` |
| renewal / first/publish               | `e47a2593d203948d2a2ed2eec5d6dc67703cd9b2d5e921e750864094f2bf8a70` |
| renewal / first/same-state-replay     | `9b90b8e0af6b584ae57374c20e7b211f360684d402aee3a97d0b294a88d4ed9c` |
| renewal / fresh/publish               | `1337cf75be74d5c9f3e138523b3c40753df3c298088def6445ceb7176b2e348b` |
| renewal / fresh/same-state-replay     | `e8318a697bf419d474308923318f4680fde0b9b35f2b3d8596858b612fa7b3c3` |

| Phase / runner      | Artifact ID   | Authenticated ZIP SHA-256                                          |
| ------------------- | ------------- | ------------------------------------------------------------------ |
| incremental / first | `12594361640` | `63f7b1f8b6ca4a51fe3bb30bfbfba25bc16429c8760c030d4cb2864405ad3655` |
| incremental / fresh | `12593367907` | `907a74f7fb1b47c186c8d6fff9f02dacaf1df074f596a5c016d88995a9ddd983` |
| renewal / first     | `12594061569` | `e40b42f6b4921a08f5fca89eaaa3f1bd7fdb7638fa63cee8b7a4c6cb01958da0` |
| renewal / fresh     | `12593776919` | `5a6ec5d02f6d6236f6df6adc090bcdc35533312f9d4f96bf3ef851097a257309` |

- Incremental advanced 14 → 17 entries and 21 → 28 archive URLs from baseline SHA-256 `9001895ef154cb0c312032b22dce73e593b8ac36a86924d5dee5224ab61fdb30`. Frozen window: `2026-10-25T09:13:00Z` → `2026-11-01T09:13:00Z`.
- Incremental first-run receipts attest the controlled interruption/resume checkpoint; fresh-runner receipts correctly report no interruption.
- Renewal preserves exact package sequence and 28-archive coverage with empty publications, inputs, mirror tags and added hashes. Frozen window: `2026-10-25T09:21:00Z` → `2026-11-01T09:21:00Z`.
- Workflow artifacts authenticate retained receipt/catalog bytes; signature verification is attested by the distributed ELF workflow, not independently reexecuted by the collector. ZIP identities/digests are retained collector bindings.
- The released source includes the CDN stale-read correction. These successful runs do not establish a controlled live stress test of more than four stale CDN reads.

## Preserved authentication failure and inventory

- Replacement provider-public success is a separate run `40178072265`. Original provider public run [40176009276](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40176009276) failed HTTP `401` during identity GET, before writes. It remains a failed attempt, not relabeled as a pass.
- All 42 historical releases and baseline catalog remained unchanged through that failure and credential renewal. Before incremental there were 45 releases: those same 42 plus the three newly qualified `1.0.4` author releases.

## Older 0.14.1 history remains separate

See [the 2026-10-23 stable CLI evidence](MARKETPLACE_STABLE_CLI_2026_10_23.md).

The older renewal failure `40032302758` and delayed recoveries `40033620593` / `40033732972` remain 0.14.1 historical evidence. They are not fresh first-pass 0.14.2 renewal qualification and are not counted in this table.

## Scope and exclusions

- Public disposable QA fixtures only; no production marketplace activation.
- Native archive validation/target matrix is not native fixture execution, backend conformance, managed installation, or client/UI QA. None of those are claimed.
- Source/macOS planning helpers and synthetic local tests are not released-ELF qualification evidence.
- Production authority, signing keys and marketplace visibility were not changed by this qualification.
- This record was assembled read-only from retained local evidence; no network refresh or new qualification was performed while writing it. Tokens were never included in qualification inputs or this document.
