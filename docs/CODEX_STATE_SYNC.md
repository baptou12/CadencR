# Codex session-state synchronization investigation

## Evidence (2026-09-12)

Production was queried read-only. No production session was resumed, interrupted,
or modified during this investigation.

- Installed binary: `codex-cli 0.154.0`.
- Conversation: **Define Provider Boundary Spec**, feature `2284`, session `3793`.
- Root runtime thread: `019fc2bc-6c05-7db2-8933-46942a31af27`.
- At `10:03:30 UTC` the root emitted `task_complete`; the persisted Cadencr
  session became `completed` at the same time.
- Its children continued until `10:03:50`, `10:06:19`, and `10:08:17 UTC`.
  Their content was still arriving after the persisted end time, sometimes with
  no `parent_tool_use_id`.
- The resumed work was announced as `subAgentActivity.kind = interacted`
  (`followup_task`), not a fresh spawn. Cadencr previously ignored this kind.
- An earlier root turn ended at `07:11:11 UTC` with
  `Selected model is at capacity. Please try a different model.` Cadencr's
  `turn/completed` conversion previously discarded the turn's error entirely.

The native root rollout contains no automatically started root turn after those
children finished. Later root turns were user initiated. A successful final
answer, a provider capacity failure, and a running descendant are distinct facts:
a UI fix must not manufacture a new user instruction or retry an unsuccessful
model request.

## Sources and compatibility

- [Official Codex changelog](https://learn.chatgpt.com/docs/changelog): CLI
  `0.154.0` released September 9; earlier entries describe parent sub-agent
  completion activity and reloading multi-agent children through the parent.
- [Official App Server documentation](https://learn.chatgpt.com/docs/app-server):
  consume `thread/status/changed`, thread lifecycle, and turn notifications;
  thread status and an individual turn's terminal result are different signals.
- The installed binary's schema was generated with
  `codex app-server generate-json-schema --experimental`. Its sub-agent activity
  kinds are `started`, `interacted`, `interrupted`, and `completed`.

This establishes missing integration behavior, not the exact upstream release
that first introduced each symptom. There is no version-string gate or raised
minimum CLI version in the correction. Existing `turn/*`, raw spawn, collab-tool,
and legacy result-synthesis paths remain supported. Unknown thread status values
are ignored rather than treated as successful completion.

## Correction

| Area                | Behavior                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root identity       | Seed it from the actual session, not the first multiplexed turn.                                                                                             |
| Descendant routing  | Recover routes from resumed `thread/started` and `interacted` activity; preserve known routes and exclude Guardian/review sources.                           |
| Completion          | Defer the root's terminal event while known children run, then finish when the last child finishes, even if Codex never restarts the parent.                 |
| Autonomous activity | Accept explicit thread status as well as legacy turn boundaries; use a provider-neutral activity signal so both the WS state and DB snapshot become running. |
| Failure             | Surface terminal root/child errors; a slow child does not delay reporting a root failure.                                                                    |
| Stop                | Interrupt root and children concurrently with bounded requests; resolve status-only child turns on Stop and surface unresolved/failing targets.              |
| Coordination        | Instruct Codex to collect required delegated results before finalizing; preserve explicit background handoffs and status-only replies.                       |

Provider-specific changes remain in the Codex adapter. Shared changes are limited
to the provider-neutral turn-start source enum and scoped error deduplication:
an error nested under a child must not suppress a separate root error.
The frontend retains its single `session_status` source of truth. No optimistic
state, polling timer, dependency upgrade, SDK protocol change, or database
migration is introduced. No autonomous prompt is injected after completion.

## Verification scope

- Unit coverage includes legacy root-only completion, missing `threadId`,
  multiple concurrent children, root resumption, status-only activity, resumed
  child routing, child completion without root auto-resumption, failures, and
  parent-reported activity without a child stream.
- Live HTTP/WebSocket QA uses an isolated database and a deterministic fake CLI
  to reproduce legacy completion, a completed parent with two running children,
  reconnect snapshots, persisted child nesting, capacity errors, and Stop.
- Live CLI verification and final check results are reported separately in the
  investigation handoff. Deterministic protocol replay is not proof that every
  older CLI binary or the provider's internal multi-agent scheduler was tested.

### Final results

| Check                               | Result                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Codex adapter unit tests            | 231 passed                                                                                                                           |
| Canonical session-status unit tests | 11 passed                                                                                                                            |
| Stream-reader unit tests            | 42 passed                                                                                                                            |
| Isolated HTTP/WebSocket replay      | 8 passed: legacy, concurrent children, late restart, terminal error, Stop, status-only Stop, unresolved Stop, child then root errors |
| Native CLI `0.154.0`                | Minimal no-tools/no-subagents turn returned `STATE_SYNC_OK`; active-to-idle verified                                                 |
| Static checks                       | Workspace lint, desktop type-check/Knip, Rust formatting, provider boundaries, diff whitespace                                       |

No frontend visual QA, full repository test suite, or execution of older CLI
binaries is claimed. Knip reported configuration hints, not unused-code failures.
QA transcripts and service logs are under `/tmp/cadencr-codex-sync-qa/`.

### Changed files

All source paths below are relative to `packages/service/src/domain/agents/`.

- `adapter/event_types.rs`
- `codex/event_lifecycle.rs`
- `codex/event_loop.rs`
- `codex/event_state.rs`
- `codex/event_subagent_activity.rs`
- `codex/event_subagent_routes.rs`
- `codex/event_turn_state.rs`
- `codex/events/mod.rs`
- `codex/events/signals.rs`
- `codex/instructions.rs`
- `codex/mod.rs`
- `codex/session.rs`
- `codex/session/interrupt.rs`

Additional provider-neutral source files:

- `packages/service/src/domain/ws_session/handler/session_prompt/stream_reader_task_event.rs`
- `packages/service/src/domain/ws_session/handler/session_prompt/stream_reader_turn_state.rs`
- This report: `docs/CODEX_STATE_SYNC.md`.

## Finish-job review (2026-09-13)

Three independent reviews covered reuse, quality, and efficiency. Follow-up fixes:

- Reuse the canonical parent setter for rehydrated grandchildren, preserving both
  the typed and raw nesting identifiers.
- Scope error deduplication to the root: child errors remain visible without
  hiding a subsequent distinct root failure.
- Keep status-only active children in the interrupt snapshot; resolve their latest
  turn using `thread/read` only when Stop is requested. Missing turns/read errors
  are reported, not silently treated as a successful interruption.
- Dispatch interrupts with concurrency capped at eight and a bounded timeout per
  RPC, so a stalled child cannot delay sending Stop to the root. Aggregate errors
  after attempting the targets. Preserve the legacy stale-root fallback.

New inline regressions cover grandchild nesting, child/root error scoping,
concurrent interrupt dispatch, aggregation of failures, empty/successful targets,
and latest-turn resolution with a missing-turn error. The isolated replay adds
status-only Stop, unresolved Stop, and distinct child/root failures.

Final finish-job verification: 284 targeted Rust tests passed (231 Codex, 42
stream-reader, 11 canonical status), with no `FAILED` result. All eight isolated
HTTP/WebSocket scenarios and the native minimal turn passed on the rebuilt
service. QA services were stopped and ports `5116`/`5117` verified closed. Logs:
`/tmp/cadencr-codex-sync-qa/finish-job-results.log` and
`/tmp/cadencr-codex-sync-qa/finish-job-real-results.log`.
