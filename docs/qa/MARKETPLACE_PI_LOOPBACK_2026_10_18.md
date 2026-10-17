# Pi loopback model and generic-host QA — 2026-10-18

## Scope and identities

This follow-up extends the earlier
[prompt-free native checks](./MARKETPLACE_PI_NATIVE_2026_10_17.md). Actual Pi and
the extracted connector execute scripted text turns against an owned loopback
HTTP fixture, not an external model service. No personal authentication,
billable model request, model tool call, installation or publication is involved.

| Binding                        | Value                                                              |
| ------------------------------ | ------------------------------------------------------------------ |
| Tested checkout base           | `349be94f6` (runtime sources unchanged)                            |
| Candidate source commit        | `da8849bf4c573db1ffe27f5153e171c0aee4aaf7`                         |
| Connector / external Pi / Node | `0.4.0` / `0.85.1` / `22.19.0`                                     |
| Native host                    | macOS arm64                                                        |
| Extracted archive bytes        | `23829`                                                            |
| Extracted archive SHA-256      | `0ce87b036f6e7e216816153db8960689460c3563271bd445b8f97ae68f26461f` |
| Synthetic provider/model       | `cadencr-loopback-fixture/deterministic`                           |

The fixture binds only `127.0.0.1`, serves finite scripted OpenAI-compatible SSE
responses, and can hold a response open to test cancellation. It bounds request
bodies, records message digests rather than contents/headers, rejects unexpected
requests, and closes its owned connections. This is not a model implementation.

## Repeatable direct ACP test

`plugins/providers/pi/test/native-loopback.test.mjs` requires both explicit
native executable paths. With no opt-in, it skips native execution. Partial or
nonabsolute opt-in is rejected; unavailable executables and the wrong Pi version
fail. The normal fixture tests need neither Pi nor credentials.

| Case                         | Observed result                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery and initialization | Exact synthetic model; no model HTTP request during discovery; resume capability advertised                                                                      |
| First turn                   | Exact `LOOPBACK_FIRST` text, `end_turn`, and native usage propagated to ACP                                                                                      |
| Connector restart/resume     | Same session resumed after stopping/restarting the connector; next HTTP request retains the first user digest and exact prior synthetic assistant content digest |
| Resumed turn                 | Exact `LOOPBACK_RESUMED` and `end_turn`                                                                                                                          |
| Cancellation                 | Received `LOOPBACK_HELD`, sent ACP cancel notification, got `cancelled` within three seconds and observed the held response aborted                              |
| Request accounting           | Exactly three model HTTP requests; fixture failures empty; no tool permission requests                                                                           |

The cancellation deadline is shorter than the fixture's socket idle timeout, so
idle disconnection cannot substitute for the asserted ACP cancellation outcome.
The test uses existing `qaClient`/`stopChild` helpers and retains scratch.

## Actual Cadencr generic-host path

Backend API/WebSocket QA used a new isolated database, settings/HOME, workspace
and service port. The actual current-source service followed this path:

```text
Cadencr session -> GenericAcpAdapter -> extracted connector -> actual Pi
                -> owned loopback model fixture
```

The local descriptor points at an owned wrapper that clears inherited environment
and supplies isolated Pi configuration. Registration initially required a restart;
after restarting the owned service, the provider was enabled, registered,
available and not quarantined. The session's initialized response was checked
for the exact synthetic installed-provider ID and model before sending a prompt.
No built-in-provider fallback was used.

| Case                         | Observed result                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Streamed response            | Exact `HOST_LOOPBACK_OK`; session ended `turn_complete`                                                              |
| Active-stream interruption   | Received `HOST_CANCEL_PARTIAL`; interrupt ended `turn_interrupted`                                                   |
| Follow-up after interruption | Exact `HOST_RESUME_OK`; session ended `turn_complete`                                                                |
| Accounting                   | Three fixture requests, all model `deterministic`; second connection aborted; no fixture failures or WS error events |

The follow-up is not a service-restart/durable-resume test. Durable connector
restart/resume was exercised separately by the direct ACP test above.
This service check used a local descriptor, not signed-feed or managed admission.

## Safety, evidence and remaining gates

- Native children receive an allowlisted environment and isolated HOME, config,
  workspace and session storage. Version checks are disabled. No personal Pi
  configuration/authentication or inherited proxy variables are supplied.
- No OS-enforced network-isolation claim is made. Model traffic was routed to
  and observed by the owned loopback fixture; this does not certify all possible
  network behavior of the native runtime.
- The generic-host run observed all fixture connections closed, no remaining
  scratch-owned process or service listener, and retained its QA database. Other
  worktrees and production were not modified. No database was deleted/replaced.
- Private generic-host evidence remains in `report.json`, `qa.mjs` and
  `shutdown-proof.json`; raw responses, session IDs and local paths are not
  publication artifacts and are not included here.
- External-model authentication and real-model behavior, thinking/tool
  permissions, managed install/update/failure recovery, x86_64, source/artwork
  review and production publication authority remain separate gates.
- Production pins, signing keys, official releases and registry metadata are
  unchanged. The marketplace remains hidden by default.
