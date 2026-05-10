//! Per-cwd snapshot of slash commands advertised by `opencode acp` over
//! the ACP `available_commands_update` notification.
//!
//! ACP-first design: opencode pushes its full slash-command catalog
//! (built-ins like `/help`, `/init` plus user-defined entries from
//! `<cwd>/.opencode/commands/*.md`) on every `session/update` whose
//! `sessionUpdate == "available_commands_update"`. The runtime's
//! `OpenCodeAcpAdapter` mirrors each push into this store, keyed by the
//! cwd the session was spawned in. The synchronous `commands.get` WS
//! request the FE makes when the user opens the slash-command picker
//! reads the latest snapshot back out.
//!
//! Trade-off vs. the previous HTTP `/command` probe:
//! - **Pro**: zero subprocess respawns, no cache TTL, catalog stays
//!   live for the whole session lifetime, includes opencode's
//!   built-ins (which `/command` omits).
//! - **Con**: cold-start (first time the user opens a cwd in this
//!   process) returns an empty list until the first ACP session has
//!   spawned and pushed its catalog. Acceptable: the FE picker is
//!   only useful inside an active session anyway, and live updates
//!   stream in via `RuntimeEventKind::SlashCommandsUpdated`.
//!
//! See `.claude/rules/provider-boundaries.md`: the snapshot lives in
//! the opencode-specific module, populated through the existing
//! `AcpProviderHooks::record_available_commands` seam, and read back
//! by the opencode adapter only.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use tokio::sync::RwLock;

use crate::domain::agents::adapter::{RuntimeError, RuntimeSlashCommand};

static SNAPSHOTS: OnceLock<RwLock<HashMap<String, Arc<Vec<RuntimeSlashCommand>>>>> =
    OnceLock::new();

fn snapshots() -> &'static RwLock<HashMap<String, Arc<Vec<RuntimeSlashCommand>>>> {
    SNAPSHOTS.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Replace the snapshot for `cwd` with the latest ACP-advertised list.
///
/// Visibility scoped to the opencode module so the ACP runtime hook
/// (`opencode::acp::adapter::OpenCodeAcpAdapter::record_available_commands`)
/// can mirror updates while keeping the snapshot store as
/// implementation detail.
pub(in crate::domain::agents::opencode) async fn record_snapshot(
    cwd: &str,
    commands: Vec<RuntimeSlashCommand>,
) {
    snapshots()
        .write()
        .await
        .insert(cwd.to_string(), Arc::new(commands));
}

/// Read the latest snapshot for `cwd`. Returns an empty list when no
/// ACP session has yet pushed a catalog for this cwd in this process.
pub(in crate::domain::agents::opencode) async fn runtime_slash_commands(
    cwd: &str,
) -> Result<Vec<RuntimeSlashCommand>, RuntimeError> {
    let snapshot = snapshots().read().await.get(cwd).cloned();
    Ok(snapshot.map(|arc| (*arc).clone()).unwrap_or_default())
}

#[cfg(test)]
pub(super) async fn reset_for_test() {
    snapshots().write().await.clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::agents::adapter::RuntimeSlashCommandKind;

    /// Tests share the process-global snapshot map; serialize them.
    static TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    fn cmd(name: &str) -> RuntimeSlashCommand {
        RuntimeSlashCommand {
            name: name.to_string(),
            description: Some(format!("desc for {name}")),
            kind: RuntimeSlashCommandKind::Command,
        }
    }

    #[tokio::test]
    async fn cold_lookup_returns_empty_list() {
        let _guard = TEST_LOCK.lock().await;
        reset_for_test().await;
        let result = runtime_slash_commands("/cold").await.expect("ok");
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn record_then_lookup_returns_latest_snapshot() {
        let _guard = TEST_LOCK.lock().await;
        reset_for_test().await;
        record_snapshot("/repo", vec![cmd("compact"), cmd("help")]).await;
        let result = runtime_slash_commands("/repo").await.expect("ok");
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "compact");
        assert_eq!(result[1].name, "help");
        reset_for_test().await;
    }

    #[tokio::test]
    async fn second_record_replaces_prior_snapshot() {
        let _guard = TEST_LOCK.lock().await;
        reset_for_test().await;
        record_snapshot("/repo", vec![cmd("first")]).await;
        record_snapshot("/repo", vec![cmd("second"), cmd("third")]).await;
        let result = runtime_slash_commands("/repo").await.expect("ok");
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "second");
        reset_for_test().await;
    }

    #[tokio::test]
    async fn snapshots_are_per_cwd() {
        let _guard = TEST_LOCK.lock().await;
        reset_for_test().await;
        record_snapshot("/a", vec![cmd("alpha")]).await;
        record_snapshot("/b", vec![cmd("bravo")]).await;
        let a = runtime_slash_commands("/a").await.expect("ok");
        let b = runtime_slash_commands("/b").await.expect("ok");
        assert_eq!(a[0].name, "alpha");
        assert_eq!(b[0].name, "bravo");
        reset_for_test().await;
    }
}
