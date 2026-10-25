# Marketplace operational preparation

## Authority and deployment gates

v0.13.0 ships hidden UI, not a public registry launch. The next milestone publishes
reviewed themes and Pi before a future desktop activation. Procedures involving
signing, tags, feed advancement, production pins or remote writes require reviewed
targets/inputs and protected operator authority; preparation alone is insufficient.
Examples are syntax, not actual keys, destinations or assigned owners. No scheduler
is deployed here. Earlier distributed CLI qualification is dated evidence, not
production deployment. The locally selected `0.14.2` includes
standalone Rust diagnostics and the bounded discovery-convergence correction.
Its exact distributed executable passed first-pass renewal, unchanged replays,
fresh-runner recovery and three-kind publication checks; see the
[current qualification record](../../docs/qa/MARKETPLACE_STABLE_CLI_2026_10_25.md).
The historical renewal failure remains failed and its exact cause unknown.

| Required record before activation | Accountable role / evidence                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| Renewal and backup owner          | Named maintainers, handoff and protected environment access review                         |
| Incident and revocation owner     | Named decision maker, monitored security contact and escalation backup                     |
| Alert delivery                    | Real monitored destination, failed-run subscription and acknowledged test alert            |
| Recovery                          | Reviewed offline-root custody, replacement app-delivery owner and tabletop evidence        |
| Deployment                        | Real feed URLs, protections, reviewed trust roots and populated provider/theme catalog     |
| Runtime cutover                   | Exact distributed binary qualified; three local pins selected; production adoption pending |

The owners and live controls above remain unassigned/unverified in this template.
The local contribution/publisher, author and qualification pins select the same
qualified Rust binary with no JavaScript fallback. Selection is not production
adoption or publication authority: fresh bootstrap/cutover approval, actual
bootstrap merge and hosted checks remain pending. See the
[local review record](../../docs/MARKETPLACE_CLI_PIN_REVIEW_2026-10-21.md).
Reinspect the remote default branch and follow the
[deployment sequence](README.md#remote-deployment-requires-two-reviewed-changes).
The JavaScript business implementation has been removed from this source template;
that does not deploy these changes or authorize desktop trust/feed/key changes.

## Read-only expiry and failure alert preparation

Use the **locally selected qualified Rust CLI**. Run this
read-only diagnostic against local catalog/provider/theme-policy snapshots:

```sh
cadencr registry check-metadata-expiry \
  /reviewed/snapshots/managed-index.json \
  /reviewed/snapshots/managed-blocklist.json \
  /reviewed/snapshots/managed-theme-blocklist.json
```

- Reads at most three regular non-symlink files, each at most 32 MiB; no network,
  signing, credentials, writes, deployment or provider execution.
- Uses the current UTC clock. Exit `1` means malformed/unreadable data, future
  generation, invalid interval, expired metadata or **72 hours or less** remaining.
  Exact expiry is failure. Exit `0` means only the timestamp diagnostic is healthy.
- `authenticated: false` is deliberate: this does **not** verify signatures,
  shape/contracts, feed availability, trust generation, monotonicity or provenance.
  A tampered timestamp can look healthy; never use the result as acquisition or
  publication authority. Independently authenticate fetched bytes with the reviewed
  Rust trust profile and domain-specific validator before recording a healthy feed.
- After deployment is authorized, wire a read-only job at least daily with bounded
  HTTPS snapshot acquisition (no redirects/credentials), independent verification
  and this diagnostic. Missing feeds and verification failures must fail the job.
  Do not attach signing or GitHub write tokens to monitoring.
- Subscribe the actual alert destination to **all failed runs**, not only expiry
  warnings. Include run URL, feed namespace and remaining validity; exclude secrets.
  A separate watchdog must alert on a missing scheduled run within 24 hours.
  Escalate unacknowledged alerts to the backup owner; test delivery before launch.

No workflow/schedule or synthetic alert test here establishes live alert delivery.
Exercise expiry, corrupt signature, unavailable feed and missing-run alerts in an
isolated environment, and retain real acknowledgment evidence as an activation gate.

## Renewal runbook

1. Renewal owner authenticates and archives exact current catalog and both policy
   envelopes, trust generation, feed heads and immutable publication receipts.
   Investigate divergence/unavailable bytes; never pick an unsigned alternate baseline.
2. Plan renewal before the 72-hour warning; create strictly newer whole-second UTC
   generations within each contract's validity bounds. The catalog's maximum
   publication window is 14 days. Catalog renewal uses an authenticated baseline
   and `publications: []`: no historical package rebuild/download or release mutation.
3. Review the exact request/commit and policy payloads in the protected environment.
   Never extend timestamps without new signatures. Renew policies independently;
   a fresh catalog cannot extend provider or theme revocation policy validity.
4. After explicit publication authority, use the qualified Rust pipeline and local
   policy signing/verification commands in [release configuration](../../docs/MARKETPLACE_RELEASE_CONFIG.md).
   Preserve exact content-bound state after any error; reconcile the same operation
   rather than retrying new writes or rolling back. A failed final verification can
   leave remote state advanced without a success receipt.
5. Independently fetch public bytes without credentials; authenticate all namespaces,
   confirm high-water continuity and expiry, then verify a supported packaged client.
   Retain run/receipt evidence and acknowledge/clear alerts only after these checks.

### Source-only discovery convergence correction

This historical heading is retained for existing links. The correction is now
included in qualified `0.14.2`; it is no longer source-only.
A deterministic regression reproduces the failure class: after discovery advances, its stable
public URL serves the exact previous signed catalog before serving the candidate.
This does not establish which response caused the historical hosted error.

- Keep the canonical stable discovery URL and request cache revalidation; a
  commit-pinned alternate URL is not proof that the configured feed is current.
- Allow at most four public reads in a shared 30-second convergence window,
  including inter-read authenticated head checks and backoff. Each HTTP request
  receives only the remaining budget, including response-body reads. This is not
  a 30-second bound on the complete publication command or its other validations.
- Only fully read bytes matching the reviewed predecessor's exact SHA-256 may
  trigger another read. Bootstrap has no predecessor allowance. The observation
  remains bounded by the discovery size limit; only the exact candidate size and
  SHA-256 can produce success.
- Unknown content, invalid/truncated/oversized responses, redirects, transport or
  cleanup errors remain terminal. Recheck authenticated candidate identity and
  freshness before additional reads; retain the final release/tag/asset checks.
- Never repeat publication mutations, CAS, or the whole pipeline automatically.
  Persistent predecessor bytes exhaust the budget without a success receipt.
  Preserve the original operation after failure, as required by step 4 above.

Merge, green CI, CLI-only release and exact distributed-binary qualification
are recorded in the October 21 evidence, including first-pass renewal, same-intent
replay and clean-runner recovery. Production adoption still requires separately
approved delivery. A separately reviewed new operation
may follow a reconciled prior operation; if an attempt fails, preserve its exact
request, commit and timestamps rather than replacing them to manufacture success.

## Revocation incident runbook

1. Incident owner records report, affected identity/version/digest, namespace and
   evidence. Decide whether to block an entire identity, version range or digest;
   automation does not make that judgment. Preserve forensic evidence and receipts.
2. Prepare a new reviewed policy with a visible reason and strictly newer generation.
   Theme policy is domain-bound `kind: "theme-blocklist"`; never reinterpret a
   provider policy as a theme policy. Sign and independently verify exact bytes.
3. Authorized publisher advances only the intended policy feed, then verifies public
   bytes and a packaged client: matching content fails closed, removal remains
   possible. Do not disable verification to mitigate a missing/expired policy.
4. Notify security contact and affected users; retain incident timeline and ownership.
   Reversing a revocation is a new reviewed policy generation, not deletion of history.

## Key rotation and compromise

- Ordinary delegated-key rotation: independently provision B; offline root signs a
  strictly higher trust generation retaining A only with a fixed retirement cutoff.
  Deliver reviewed trust/root pins to supported apps **before** B-signed feeds.
  Exercise historical A receipts/cache → B continuity; old apps are not retrofitted.
- Compromise: incident owner suspends affected publication access, preserves evidence,
  removes A and includes it in `revoked_key_ids`. Do not retain a compromised key as
  historical authority. Root-authorized exact canonical-envelope recovery checkpoints
  are namespace-specific baselines only, never current metadata/receipt authority.
- Re-sign successors with independent B, authenticate every public namespace, and
  verify packaged-client fail-closed and recovery behavior. Unknown cache history
  requires reviewed recovery, never database/cache deletion or unapproved rollback.
- Offline-root compromise/replacement requires an independently reviewed app-delivery
  incident. Publication automation cannot replace its own root of trust.

See [trust-generation procedures](../../docs/MARKETPLACE_RELEASE_CONFIG.md#root-authorized-trust-generations)
for exact manifests and command syntax. A local fixture drill is not production key
rotation, revocation delivery or deployed monitoring evidence.
