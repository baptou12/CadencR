//! Shared modules that survive the ws-feature removal. ws-session relies
//! on the worktree setup and a couple of small helpers; the multi-stage
//! workflow engine, agent manager, queue advancer, strategies, etc. were
//! all part of ws-feature and have been deleted.

pub mod worktree;
pub mod ws_sender;
