# Historical Claude-first branching plan: delivery

> Archived during the v0.13.0 review on 2026-10-13. This preserves the original
> implementation plan, including superseded decisions and proposed fixes.
> Use [the current reference](../../REWIND_AND_FORK.md) for shipped behavior.

## 10. Edge cases & failure handling

- **Missing `provider_message_uuid`** (older messages predating the column):
  fall back to **ordinal matching** — cut before the Nth `type=="user"` line in
  the JSONL, where N is computed from `agent_messages` ordering. If even that is
  ambiguous, fall back to non-truncating resume + warn.
- **Missing checkpoint** (capture failed or message predates the feature): code
  rewind is unavailable for that message. Still allow **conversation** rewind;
  disable the "restore code" affordance and tell the user.
- **Uncommitted user edits at rewind:** require explicit confirm (request flag);
  the UI shows a dialog. Mirrors native `/rewind` warning. Never discard silently.
- **Surgery / JSONL format drift:** never hard-fail — fallback resume + toast.
  Add a lightweight format sanity check (expected top-level keys) and log the CLI
  version for triage.
- **`git clean -fd`** must **not** use `-x` (would nuke ignored files like
  `.env`, `node_modules`). Restrict to the worktree path.
- **Files outside the worktree / bash `rm`/`mv`:** not covered (documented
  limitation, same as native).
- **No multi-session switcher needed (fork):** rather than display two sessions in
  one feature, fork mints a **new feature** — a first-class view the client
  navigates to. This sidesteps the "can the feature UI show >1 session?" question
  entirely.
- **Resume scoping:** `claude --resume <id>` is scoped to the cwd it was created
  in; the forked `.jsonl` must live in the **same** `~/.claude/projects/<encoded
  cwd>/` dir as the source (it does, because the forked feature shares the source
  worktree, so the cwd is identical).
- **Error surfacing:** every failure path returns a typed error and a toast (no
  silent catches) per `.claude/rules/error-handling`.

---

## 11. Phased delivery (each phase independently shippable)

- [x] **Phase 1 — Checkpoints subsystem (provider-neutral).** `domain/checkpoints/`
      (`git_ops` + `repo` + `mod`), `turn_checkpoints` migration, capture hook on
      turn start (pending + followup), restore fn, `run_git_with_env` for the
      isolated-index snapshot. Tests: §13 git round-trip + migration cascade.
- [x] **Phase 2 — Capability seam + Claude surgery.** `SessionBranching` trait +
      `session_branching()` default, Claude `branching.rs` + `jsonl_surgery.rs`,
      `provider_message_uuid` column (ordinal cut is the Claude primary — see
      Implementation notes). Unit-tested against fixture JSONL.
- [x] **Phase 3 — Rewind orchestrator + WS route + stop-turn interplay.**
      `branch.rewind`, interrupt/close live turn, restore + truncate + db +
      draft, dirty-worktree confirm gate. DB-level tests for the delete path.
- [x] **Phase 4 — Fork orchestrator + lineage + WS route.** `branch.fork` creates
      a **new feature** sharing the source worktree (copied `worktree_*` settings),
      a session under it, message copy `[0,N)`, `feature_settings.draft_prompt`,
      `agent_message_origins` badge, and a `Created` feature event. One transaction.
      DB-level tests for the feature/worktree/copy + lineage.
- [x] **Phase 5 — Frontend.** `AgentStreamContextMenu` items gated on
      `user_message`, confirm dialog, local block truncation, draft pre-fill +
      focus, provenance badge. Fork **auto-navigates** to the new feature
      (session-scoped `forkNavigation` signal → `AgentSession` effect).
- [x] **Phase 5.1 — Live-message branchability.** Rewind/Fork target a persisted
      message id. A message sent in the *current* session is a local `ws-user-*`
      block with no DB id, so the menu items were hidden on it until reload (only
      blocks re-seeded from the DB as `msg-<id>` were branchable). Fix: every
      `prompt.send` now carries a **`user_message_ref`** — a client-generated id
      stored on the local block as `clientMessageId`, generated for *every* send
      (first/queued, idle follow-up, and steering) and threaded through the queue
      for the first message. The backend echoes it in a `session/prompt_persisted`
      ack to the sender right after persisting the user message (both the initial
      and follow-up persist sites). The frontend stamps `messageDbId` on the
      matching live block (id/key left untouched → no Virtuoso remount) and the
      gate reads `block.messageDbId ?? messageIdFromBlockId(block.id)`. The ack is
      emitted at persist time (before the agent acks), so it precedes any
      `prompt_received`. Note `user_message_ref` is deliberately distinct from
      `client_message_id` (receipt/steering-only) so idle/first sends don't engage
      the receipt machinery. **Known gap:** plan approve/reject synthetic messages
      (`ws-session-actions.ts`) bypass `sendPrompt` and remain reload-only.
- [x] **Phase 6.1 — Transcript-path encoding fix.** `encode_project_path`
      (`imports/claude_code_jsonl.rs`) replaced only `/` with `-`, but Claude
      Code replaces *every* non-alphanumeric char (so `/.cadencr` → `--cadencr`,
      not `-.cadencr`). Since all Cadencr worktrees live under `~/.cadencr/`, the
      derived `~/.claude/projects/<dir>` was wrong for every session: the
      transcript was never found, `truncate_before` returned
      `BranchError::Unsupported("transcript not readable …")`, and rewind/fork
      fell back to resuming the **full, un-trimmed** history while showing a
      "Context could not be trimmed" warning. The DB/code rewind still worked, so
      it *looked* fine, but the agent kept its full memory. Fix: replace all
      non-alphanumeric chars with `-`. Also repairs Claude **import** for any
      dotted project path. Regression-tested (`encode_project_path_collapses_dot_dirs`).
- [x] **Phase 6 — Hardening.** Surgery fallback path, JSONL format guard,
      ordinal-match fallback, telemetry (tracing), docs. `pnpm test` / `lint` /
      `ts-check` / `knip` green.

---

## 12. Future providers (Codex, OpenCode)

The seam is already provider-neutral. To add a provider later:

- Implement `SessionBranching::truncate_before` for it and return it from that
  adapter's `session_branching()`:
  - **Codex** — operates on its rollout/session files (its own transcript store);
    same "copy + truncate + new id" shape, different file format. Note Codex
    already has `interrupt`/`steer` (`codex/session.rs:221`, `:325`) the
    orchestrator's stop-turn step reuses.
  - **OpenCode** — operates on its own session storage; same shape.
- **Nothing else changes.** The checkpoints subsystem, orchestrator, DB schema,
  WS routes, and the entire frontend are reused as-is. `provider_message_uuid`
  and `turn_checkpoints` are already provider-neutral. Generic code must continue
  to never branch on provider identity (project rule); all per-provider logic
  stays inside that provider's `branching.rs`.

---

## 13. Testing

- **Checkpoints (Phase 1):** Rust tests in a temp git repo — capture creates a
  ref + row; restore returns the tree to the snapshot incl. added/deleted files;
  `clean -fd` removes new untracked files but preserves `.gitignore`d ones; the
  user's real index is untouched (isolated `GIT_INDEX_FILE`).
- **Surgery (Phase 2):** fixture `.jsonl` → assert cut index, `sessionId`
  rewrite, atomic write, and that a malformed line triggers the fallback error
  rather than a panic.
- **Orchestrator (Phase 3/4):** with a fake `AgentRuntimeSession`
  (`session.rs` already has test fakes) assert: live turn is interrupted before
  mutation; rows `>= N` deleted (rewind) / `[0,N)` copied (fork);
  `runtime_session_id` swapped/created; draft saved; lineage row written.
- **Steering/cancel interplay:** test that triggering rewind during an `Active`
  turn interrupts it first, and during `Pending` skips interrupt.
- **Frontend:** vitest for store truncation + draft pre-fill; the `qa` skill for
  an end-to-end smoke test (rewind a real Claude session, confirm context and
  code both rolled back and the draft is pre-filled but unsent).
- Run `pnpm test`, `pnpm lint`, `pnpm --filter @cadencr/desktop ts-check`, and
  (after any Rust API surface change) `pnpm --filter @cadencr/desktop run
  generate:api`.

---

## 14. Open questions to confirm before/during build

1. **Multiple sessions per feature in the UI** — RESOLVED by not needing it: fork
   creates a **new feature** (its own view), so the feature view never has to host
   >1 session. The client auto-navigates to the new feature after fork.
2. **Fork code semantics** — confirmed v1 = no code rollback (conversation-only),
   and the forked feature **shares** the source worktree. Revisit only if product
   wants an "isolated fork" mode (own worktree branched from the fork-point
   checkpoint), which reverses the shared-worktree decision.
3. **Checkpoint retention** — when to GC `refs/cadencr/checkpoints/*` and
   `turn_checkpoints` rows (e.g. on feature delete, or a depth cap). Native
   Claude GCs at 30 days; pick a policy in Phase 1.
