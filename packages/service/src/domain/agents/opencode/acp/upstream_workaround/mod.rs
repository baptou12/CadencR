//! Workarounds for limitations in OpenCode's ACP implementation.
//!
//! Each module under this directory exists because something OpenCode
//! does *not* expose over the ACP JSON-RPC wire forces us to fall back
//! to the embedded HTTP backend. The same `opencode acp` subprocess we
//! already spawn for ACP also serves HTTP on its `--hostname --port`
//! flags (see `Server.listen({hostname, port})` in
//! `opencode/src/cli/cmd/acp.ts` upstream — the same flags `acp/mod.rs`
//! passes when spawning the subprocess). This is **not** the legacy
//! OpenCode HTTP transport (`packages/service/.../opencode/http/` plus
//! `opencode-sdk-rs/src/sse/**`); that transport is being retired and
//! its code is dead. The embedded HTTP backend is part of the ACP
//! subprocess and stays for as long as the workarounds here need it.
//!
//! ## Current modules
//!
//! - **`subagent_listener`** — OpenCode's `ACPSessionManager`
//!   (`opencode/src/acp/agent.ts`) silently drops `message.part.updated`
//!   events for sessions not registered with it. The `Task` tool spawns
//!   a child session that Cadencr never loads over ACP, so child events
//!   never reach us; only the final `tool_call_update {status:"completed",
//!   rawOutput}` blob does. We poll the embedded HTTP backend's
//!   `GET /session/{id}/children` and `GET /session/{id}/message` to
//!   discover child sessions and tail their messages, then synthesise
//!   `RuntimeEvent`s tagged with `parent_tool_use_id` so the FE nests
//!   them under the parent Task block.
//!
//! ## Removal criteria
//!
//! Each workaround tracks a specific upstream limitation. When that
//! limitation is fixed:
//!
//! 1. Delete the workaround module here.
//! 2. If no remaining module needs the embedded HTTP backend, the
//!    `--hostname --port` plumbing in `acp/mod.rs` (and the matching
//!    REST methods on `opencode_sdk_rs::OpenCodeClient` —
//!    `list_messages`, `list_children_in_directory`) can also be
//!    removed. Note that `question_sidecar.rs` is *not* a workaround —
//!    it's a designed sidecar for the question tool that uses the same
//!    embedded backend, so it would also need to migrate before the
//!    `--port` flag can go.
//!
//! Do **not** confuse "delete the legacy HTTP transport" with "delete
//! the embedded HTTP backend usage". Those are independent removals.
//! A future engineer doing the former should leave this directory
//! untouched.

mod subagent_listener;

// Re-export the symbols the OpenCode ACP adapter consumes. Keeping the
// re-exports here (rather than `pub(in …)` on the items themselves) means
// the adapter's import path is `super::upstream_workaround::{…}` — short,
// and a grep for `upstream_workaround::` lands directly on every consumer.
pub(super) use subagent_listener::{spawn_subagent_listener, PendingSubagentTasks};
