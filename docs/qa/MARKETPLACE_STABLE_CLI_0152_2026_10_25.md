# Stable CLI 0.15.2 qualification — 2026-10-25

> Qualification complete: all thirteen gates passed at run time on the exact distributed ELF, with no manual CDN wait anywhere. One attempt (the first policy-lifecycle run) failed because of a harness check and is preserved. Monorepo pins have not been changed by this record; the deployed registry pin and production readiness remain separate gates.

## Binary and fixture provenance

| Binding                                      | Reviewed value                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distributed Linux ELF                        | `cadencr` `0.15.2`, asset `cadencr-v0.15.2-x86_64-unknown-linux-gnu`, `5992720` bytes                                                                                   |
| Released ELF SHA-256                         | `f4a719871f776bdbbb9845ac98eb381a85da5730237e0c9b50c2e15198fc4031`                                                                                                      |
| Release tag                                  | `cli/v0.15.2` (`released-cli.env` asset: version `0.15.2`, tag `cli/v0.15.2`, the SHA-256 above)                                                                        |
| Released source commit                       | `07a41cbcacbcf7bdcfddb514313cbe9d146c101b`                                                                                                                              |
| Release run                                  | [40237643528](https://github.com/merkr-software/cadencr/actions/runs/40237643528) (attempt `1`; `provenance.json` binds source, tag, asset and digest)                  |
| Public inert fixture source — not CLI source | `3c8035b279bd7c2bf944ad7900ab5d30cc10f4fd` (fixtures `1.0.7`; immutable tags `qa-author-cli/stable-0152-{provider,theme,tab}-20261025`)                                 |
| QA repository                                | `merkr-software/cadencr-registry-qa`, ID `1420296872`                                                                                                                   |
| Local helpers                                | Planning only, not qualification evidence: the same released ELF run under linux/amd64 emulation on the author machine to authenticate downloaded catalogs before use as `previous`; the runners re-authenticate them with the ELF |

QA main commits, in order: `3c8035b` fixtures, `84b91aa` pins + provider candidate + workflow timeouts, `dd0569d` theme candidate, `6cc0c78` tab candidate, `be6d23c` incremental, `e06b3d7` renewal, `ba6d237` policy lifecycle bound to 0.15.2 (failed attempt), `cc83e7c` policy lifecycle with polled independent public read (final QA main).

Workflow timeouts were raised in the pin commit to match the new read-back waits: `qa.yml` jobs 60 min (renewal template), `author.yml` publisher job 45 min, `policy.yml` 60 min, `recovery.yml` 60 min. Offline jobs stay at 15 min.

## Ten verified offline and author gates

All runs are attempt `1` and concluded `success`. Proof digests are complete SHA-256 values of the uploaded proof JSON. Candidate commits are the workflow heads, not CLI source commits. Each author kind used one offline dispatch (`publish=false`), one public dispatch (`publish=true`, `interrupt_draft=true`: observed empty draft terminated and resumed on the same release ID) and one fresh dispatch (`publish=true`, `interrupt_draft=false`, `not_exercised`, same release ID, identical inventory). Every publication proof records two completed retries and `publication: verified`.

| Passed gate                 | Run                                                                                           | Candidate / reviewed commit                | Proof SHA-256                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| General offline (91 checks) | [40239741290](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40239741290) | `84b91aa3563adc1609e0b66923249ef511327ac0` | `9ebb0c451c2cfd193984112c74c1cdab8f797f23cbafed168d4d5208af031f34` |
| provider offline            | [40239763283](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40239763283) | `84b91aa3563adc1609e0b66923249ef511327ac0` | `03e9c533bc5a5957cb419de3d6d391676b524ec650e9e5d125452d12e0737363` |
| provider public             | [40239783872](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40239783872) | `84b91aa3563adc1609e0b66923249ef511327ac0` | `1c408cd279e223599f0ce55537482eed6123dd2856c2ddc9c582b433a1be2e72` |
| provider fresh              | [40239841610](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40239841610) | `84b91aa3563adc1609e0b66923249ef511327ac0` | `d88d55aa067624ed15f585899a05dddcf1357c226f6fc21d2a40a375710ac177` |
| theme offline               | [40239903009](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40239903009) | `dd0569dd17eafa2856acd8cb27e7487861ebd9cc` | `57332bf567499067c524d79720c334409877c99ae91341bce354c53dcc940bd6` |
| theme public                | [40239925401](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40239925401) | `dd0569dd17eafa2856acd8cb27e7487861ebd9cc` | `3b63251fbc94af81fa55da1c2085b67d2df372c0de2e1cea4b1d1630d246741c` |
| theme fresh                 | [40239979294](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40239979294) | `dd0569dd17eafa2856acd8cb27e7487861ebd9cc` | `fb6e9f1bedde0e92e792a53bd5f2036bdebb08c6d37465acf76f461049f7e90a` |
| tab offline                 | [40240028867](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40240028867) | `6cc0c789c9862e90cf37d8471fce9fffe1a33642` | `a05ebd1d74114eb51e0f2e49a734adc32bb4f8d82dfcc9a1c782d6804f5cacbc` |
| tab public                  | [40240049725](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40240049725) | `6cc0c789c9862e90cf37d8471fce9fffe1a33642` | `2da0ba54d0136168229412b09f7aa279393868e65aac51ed187a9b0c9b55c21f` |
| tab fresh                   | [40240129337](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40240129337) | `6cc0c789c9862e90cf37d8471fce9fffe1a33642` | `7ad263691c69ad41d70cbfe0000c0318a114e6c02d850a65255e0a29c20ed3a1` |

The general offline run reports `status: passed`, 91 checks, `lifecycle_qualified: false` (offline-only by design) and `production_pins_changed: false`.

Candidate JSON SHA-256 bindings and published author releases:

| Kind     | Candidate SHA-256                                                  | Author release ID |
| -------- | ------------------------------------------------------------------ | ----------------- |
| provider | `58ef825f3d5e4b622697bdefa52b99530caecbf4df00647c56489281738a8e3b` | `423697252`       |
| theme    | `dbc3f97bc6c9af05288b41f2f5113cd5e19f0b9261d834b19e3a9a56f36d08b4` | `423698010`       |
| tab      | `23f9f8d16a378bf36bbb2e91b4d0ac9aa00779bc89dce22de2e024b164383063` | `423698745`       |

## Verified incremental and first-pass renewal

Both runs completed on attempt `1`. Each passed first publish, same-state replay, fresh-runner publish and fresh same-state replay with identical catalog/inventory within its phase. Renewal was a new first-pass run dispatched about 30 seconds after the incremental run finished (about three minutes after its catalog write), with no manual wait for the raw CDN. The `previous` catalogs were downloaded from the live branch and authenticated before use: incremental baseline `0688802d96060175794dcb87cb7d672a0bc70fd08fba01d4176b31e40bcbb143` (the 0.15.1 renewal catalog), renewal baseline `9b59c096759f2b3e7551cf3d4ca9a30509da9adbbd5eecba07b5788236868582` (the incremental result). The runner re-verifies each baseline with the pinned ELF before publishing.

| Binding         | Incremental                                                                                   | Renewal                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Run             | [40240223761](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40240223761) | [40240691232](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40240691232) |
| Commit          | `be6d23c5566d62d79e75549842628c1ccc8e27b6`                                                    | `e06b3d796a16b7da3240f617717f53fd5f0854cb`                                                    |
| Request SHA-256 | `d9ff7b8619fb50c71e61184205d13d9e4fa048acfeda27c35b3a0a75eaffe95b`                            | `894d3b69c324cbb876dcb43ed2b40f974d018fb03d00b12a5ef779e83c2c27f3`                            |
| Plan SHA-256    | `129ee118f4d4a71b118ea19a0845eec28013d417df367bbc12781a72da127cdf`                            | `7a8180c7b03f34343512e652949f4cf3ea117545a7741054cae47546f68380d7`                            |
| Catalog SHA-256 | `9b59c096759f2b3e7551cf3d4ca9a30509da9adbbd5eecba07b5788236868582`                            | `33dc7a0c75533dd953e80be1d17d85045ad9706af268b8e603e1067c64ddf59f`                            |

| Phase / receipt                       | Proof SHA-256                                                      |
| ------------------------------------- | ------------------------------------------------------------------ |
| incremental / first/publish           | `d296a0e2c8cce22df720a14324b6dbc90981d03f5fef88b4b268f2c0b1cc67ec` |
| incremental / first/same-state-replay | `1f6ff4812c70de6916d5c7a487017b2c5ca9f59f6e2788eb3913c1fe85292008` |
| incremental / fresh/publish           | `26920d3f80c2e0b1932c19fdeee15c8b670402c15c897efc336c6cff4bacb3b9` |
| incremental / fresh/same-state-replay | `d8d40ffbdecc00f852b9788c33956193e8fc0788a62cd35a4f34ea78dab9c294` |
| renewal / first/publish               | `8a6fa053b433e0bdd6f6f17a8ff89bc65611bd784d8c389bb50494cb23e654cb` |
| renewal / first/same-state-replay     | `61d9452a493a2d14a680d2c87f84675d71aed5a7ded5b1517aedb283721b8716` |
| renewal / fresh/publish               | `c38af057a8bcd723174aa7d5e5376b349da33b014bdc377e90cf84e50412fae4` |
| renewal / fresh/same-state-replay     | `34e6e7749e5f5a49f1190f5de54fedd54ae20f9535cda71b5078fcd854567a31` |

| Phase / runner      | Artifact ID   | Artifact ZIP SHA-256 (GitHub API digest)                           |
| ------------------- | ------------- | ------------------------------------------------------------------ |
| incremental / first | `12616442999` | `821e17181ec20734f7f05e468b6059b4d05bc9c5cccb8a79099a926897ed5c85` |
| incremental / fresh | `12616677815` | `95e573d417713876361f5273aa101efd64ddb7c75821ac290c080680aa150b0a` |
| renewal / first     | `12616622086` | `9315fd76312a496ba2439a1ecb8f5352e9033c2e959b8043ef2ce1ff65a5a116` |
| renewal / fresh     | `12616498480` | `ecc01c32810564b08fdfe8346ebf8f7c0e2fc5cc37f9ca36cdb7308106836dd1` |

- Incremental advanced 23 → 26 entries and 42 → 49 archive URLs (mirror tags `provider-qa-author-provider-v1.0.7`, `theme-qa-author-theme-v1.0.7`, `tab-qa-author-tab-v1.0.7`). Added-entry digests: `1ae1bbb1f390dbac9f6b46e0a0c6ceafe388d6240fb90cb27c54bfa967de4cfc`, `757963b86af48ed5ad60b41211c7f81e89aec238e06eba6208c899be982cf28c`, `7606c569d37981b16c938ac57c672148dfa31f36a93c3729c963d86c314cea6b` (derivation first reproduced the qualified `1.0.6` entries byte-for-byte). Frozen window `2026-10-25T22:24:00Z` → `2026-11-01T22:24:00Z`. Post-run inventory: 74 releases. Run-step durations: first runner 3 min 34 s (with the controlled interruption/resume), fresh runner 1 min 36 s.
- Incremental first-run receipts attest the controlled interruption/resume checkpoint (`interruption_observed: true`); fresh-runner receipts correctly report no interruption.
- Renewal preserves the exact package sequence (26 entries) and 49-archive coverage with empty publications, inputs, mirror tags and added hashes. Frozen window `2026-10-25T22:32:00Z` → `2026-11-01T22:32:00Z`. Post-run inventory: 75 releases. Run-step durations: first runner 36 s, fresh runner 31 s. The CLI does not log its public read-back wait for catalog publication; the short renewal duration shows no long wait occurred there.
- Workflow artifacts authenticate retained receipt/catalog bytes; signature verification is attested by the distributed ELF workflow, not independently reexecuted by the collector.

## Gate 13: revocation policy lifecycle — passed

Workflow `policy.yml` (QA main `cc83e7c49c093d2e80500a0f997bc91ab4f0bd04`): `workflow_dispatch` only, exact reviewed commit and `requests/stable-0152-20261025/policy.json` SHA-256 guard before any secret, pinned ELF from `cli-pin.env`, job permission `contents: write` only, `QA_SIGNING_KEY_PEM` only in the run step, shared `registry-qa-lifecycle` concurrency group, 60 min timeout. Policies are QA-only and inert (empty entries), published to the fresh QA-only branch `qa-policy-0152-r2`, created from the reviewed harness commit. `marketplace-v2`, `qa-policy-0151` and `qa-policy-0151-r2` were not touched. Payload window `2026-10-25T22:15:00Z` → `2026-11-01T22:15:00Z`; renewal expiry `2026-11-07T00:00:00Z`; `cdn_settle_seconds: 0` (the guard requires exactly zero): bootstrap and renewal run back to back with no separation.

| Item                     | Value                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Run                      | [40240933953](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40240933953), attempt `1`, `success`, job 5 min 49 s    |
| Commit / request SHA-256 | `cc83e7c49c093d2e80500a0f997bc91ab4f0bd04` / `d9dbec5454eed0e27cb58b4dbc713d487a4d089db97ef427c4aadb224fd960e1`                          |
| Proof SHA-256            | `39e3402a14db9f7381b6372f035922c27994d263aac4bdcefce0c768aab4b6d1`                                                                       |
| Artifact                 | `12616669452`, ZIP `024af8619ff20f66a6a4cfe2b38adc5e1d3f6d626ec41d19afe4812e41506c76`                                                    |
| Branch heads             | start `cc83e7c49c…`; after bootstrap `47af2a85b4…`; after renewal, replay and rollback attempts `7ff822c647…` (no write by replay or rollback) |
| Catalog / releases       | `marketplace-v2` catalog `33dc7a0c…` unchanged; 75 releases unchanged                                                                    |

| Policy   | Signed bootstrap SHA-256 (verified, bootstrapped)                  | Renewed SHA-256 (renew-policy from fetch-policy baseline; `advanced`) | Renewed `generated_at` |
| -------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------- |
| provider | `ac341d591ed32d10333e759c1efbb539337d8f897fe3787cd31f0b8cca9fa345` | `be4ff7386daa6d964bbd6fa34d30599bf41c8bb3ccde677bcdf677aff129b3b9`    | `2026-10-25T22:36:11Z` |
| theme    | `18c123813640863eefb3361fea036be0b4130a881358ef03e1964eec1dd780b8` | `7ad189160ff3c4ef8bd8b3ac390e2e6cf0f5a457742940085e8bd6699a326dc7`    | `2026-10-25T22:36:12Z` |
| tab      | `535c94ac0941c5d9b19709f6ccb3c79a35d729cdf951ee1c82757b90a78babb0` | `a57f2b744f8c4c54cb4355abd23aca7edd16317664c337d167dc1301ba9b1946`    | `2026-10-25T22:36:13Z` |

Observed publish-policy durations (wall time per CLI invocation, from the proof): bootstrap provider 3.6 s, theme 3.1 s, tab 3.7 s; first `--renewal` publication provider **294.8 s**, theme 4.4 s, tab 4.4 s; replays 2.4 s, 2.4 s, 2.7 s. The 294.8 s provider renewal is the CLI absorbing the stale raw-CDN window on its own (it waited until the public feed served the renewed bytes, within the released 360 s budget) and then returned `advanced` with a verified public feed; the theme and tab renewals ran afterwards and returned within seconds (presumably because their cache entries had expired meanwhile; not independently observed). Independent anonymous reads by the harness after each receipt (no-cache, polled up to 360 s) converged in 60-226 ms. The CLI's per-read wait is not itself logged.

For all three kinds the retained proof records: sign and verify passed; bootstrap receipt `bootstrapped` / `policy_verified` with an independent anonymous raw read equal to the signed bytes; `fetch-policy` baseline byte-equal to the bootstrap; `renew-policy` output verified with identical entries, newer `generated_at` and the reviewed expiry; `--renewal` publication `advanced` with `previous_sha256` equal to the bootstrap digest; replay of the same renewal `unchanged` with an identical branch head; republishing the older bootstrap policy refused with `REGISTRY_POLICY_PUBLICATION_FAILED` ("rollback refused", exit status 1) both plain and with `--renewal`, with branch head and blob SHAs unchanged; a final `fetch-policy` equal to the renewed bytes.

## Preserved failures and inventory

- First 0.15.2 policy run [40240830194](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/40240830194) (commit `ba6d2375597b70248e6cfe2b9051a2cda3c4db61`, request `23a7ef3493b56e588c447677fe4efe5fa8c7d9acd7da96c675c0b585cdc81c76`, branch `qa-policy-0152`), attempt `1`, `failure`, 30 s. Sign, verify, all three bootstraps and the provider `--renewal` publication all succeeded in the CLI (provider renewal committed at `22:34:56Z`, receipt written). The failure was the harness's own extra anonymous raw read immediately afterwards (plain request, no cache hint), which returned the cached bootstrap body and tripped a strict equality assertion. That is a harness check, not a CLI result. The harness fix (a no-cache, read-only poll up to 360 s that records its wait, and a new fresh branch) is a separate reviewed commit `cc83e7c`; the passing run above is the replacement. Artifact `12616812995`, ZIP `295851d5470de2ed1eb39510bdb4b006eb9e40e99ebd1df7864ea447115efc5b`. Branch `qa-policy-0152` was left as is (three bootstrapped policies, provider renewed) and was not reused or reset.
- Earlier failures on the same fixtures: the 0.15.0 policy read-back bug and the 0.15.1 CDN convergence timeouts are recorded in [the 0.15.0 evidence](MARKETPLACE_STABLE_CLI_0150_2026_10_25.md) and [the 0.15.1 evidence](MARKETPLACE_STABLE_CLI_0151_2026_10_25.md). Their branches and the stale `marketplace-v2` provider policy are untouched.
- No author, incremental or renewal run needed a rerun in this qualification. No release was removed or modified.

## Scope and exclusions

- Public disposable QA fixtures only; no production marketplace activation. Nothing in `merkr-software/cadencr-registry` was touched. Monorepo pins were not changed by this work.
- The CDN absorption is observed, not stress-tested: one renewal waited 294.8 s inside the CLI and the other publications converged quickly. Different edges served different bodies at the same moment (the CLI read the candidate while a plain harness read did not), so durations vary by edge.
- Native archive validation/target matrix is not native fixture execution, backend conformance, managed installation, or client/UI QA. None of those are claimed.
- All qualification evidence is the Linux x86_64 ELF on GitHub runners. No macOS-specific behavior was exercised; macOS and Linux client behavior still need separate platform validation.
- Source/macOS planning helpers, emulated local runs and synthetic local tests are not released-ELF qualification evidence.
- Tokens and signing material were never printed or committed. This record was assembled from retained run artifacts and the GitHub API on 2026-10-25.
