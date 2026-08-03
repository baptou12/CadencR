//! The provider-neutral ACP adapter.
//!
//! One adapter type serves every installed agent: it is parameterised by a
//! [`HostInstallation`], not written per provider. Adding an agent is a
//! descriptor file, never a Rust change.
//!
//! What it deliberately does *not* advertise is as important as what it does.
//! Models, modes, access modes, compaction, slash commands, worktree config
//! paths, and durable resume are all either negotiated over ACP per session or
//! genuinely absent from the protocol, so the catalog entry leaves them empty
//! and the trait defaults (which decline) stand. Filling them from descriptor
//! data would make marketplace JSON authoritative over `initialize` — exactly
//! the inversion `docs/PROVIDER_SPEC/BOUNDARIES.md` forbids. As negotiated
//! capabilities become part of the catalog, they arrive from the session, not
//! from here.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::domain::agents::acp::runtime::permission_events::parse_acp_permission_request;
use crate::domain::agents::acp::runtime::StandardAcpHooks;
use crate::domain::agents::acp::runtime::{spawn_acp_runtime_session, AcpRuntimeSpawnArgs};
use crate::domain::agents::acp::AcpClientInfo;
use crate::domain::agents::adapter::{
    AgentRuntimeAdapter, AgentRuntimeSession, RuntimeError, RuntimePermissionRequest,
    RuntimeSpawnConfig,
};
use crate::domain::agents::runtime::{ProviderCatalogEntry, ProviderStatus};

use super::installation::HostInstallation;

pub struct GenericAcpAdapter {
    installation: Arc<HostInstallation>,
}

impl GenericAcpAdapter {
    pub fn new(installation: Arc<HostInstallation>) -> Self {
        Self { installation }
    }
}

#[async_trait]
impl AgentRuntimeAdapter for GenericAcpAdapter {
    /// Identity comes from the portable registry entry; availability comes from
    /// the host's compatibility check. A quarantined install stays in the
    /// catalog as unavailable with its reason attached rather than vanishing.
    fn catalog_entry(&self) -> ProviderCatalogEntry {
        let agent = self.installation.agent();
        match self.installation.quarantine() {
            Some(quarantine) => ProviderCatalogEntry::unavailable(
                agent.id.clone(),
                agent.name.clone(),
                &quarantine.message,
            ),
            None => ProviderCatalogEntry {
                id: agent.id.clone(),
                label: agent.name.clone(),
                status: ProviderStatus::Available,
                status_message: None,
                // Models, modes, and access modes are session-negotiated ACP
                // state. An empty list is the honest answer before `initialize`.
                models: Vec::new(),
                modes: Vec::new(),
                access_modes: Vec::new(),
                default_model: None,
            },
        }
    }

    /// `session/load` is an optional ACP capability that is only known after
    /// `initialize`. Declining resume up front means a follow-up prompt starts
    /// a fresh ACP session instead of failing the spawn outright against an
    /// agent that never advertised it.
    fn is_valid_resume_session_id(&self, _session_id: &str) -> bool {
        false
    }

    fn resolve_resume_session_id(&self, _runtime_session_id: Option<&str>) -> Option<String> {
        None
    }

    /// Read back the runtime's own provider-neutral permission envelope so
    /// standard ACP `session/request_permission` prompts reach the user.
    fn parse_permission_request(&self, raw: &Value) -> Option<RuntimePermissionRequest> {
        parse_acp_permission_request(raw, None)
    }

    /// Exec the program directly with its argument vector.
    ///
    /// This is a deliberate divergence from the built-in ACP adapters, which
    /// launch through `cli_discovery::login_shell_exec_command` (`$SHELL -l -c
    /// "exec …"`). `BOUNDARIES.md` Phase 8 requires that marketplace data never
    /// be interpolated into a shell command, and a descriptor is marketplace
    /// data; the service already hydrates its own environment from the login
    /// shell at startup (`shared::login_env`), so the child still inherits a
    /// terminal-like `PATH` without a shell in between. Do not "fix" this to
    /// match the built-ins.
    async fn spawn(
        &self,
        content: Value,
        config: RuntimeSpawnConfig,
    ) -> Result<Box<dyn AgentRuntimeSession>, RuntimeError> {
        let executable = self.installation.launchable().map_err(RuntimeError::new)?;
        let mut command = tokio::process::Command::new(&executable.command);
        command.args(&executable.args);
        command.current_dir(&config.cwd);
        for (key, value) in &executable.env {
            command.env(key, value);
        }
        // Caller-supplied env wins over the descriptor's, matching how the
        // built-in ACP adapters let a spawn override their defaults.
        if let Some(env) = config.env.as_ref() {
            for (key, value) in env {
                command.env(key, value);
            }
        }
        spawn_acp_runtime_session(AcpRuntimeSpawnArgs {
            command,
            spawn_guard: None,
            client_info: AcpClientInfo::default(),
            config,
            initial_content: content,
            // Context window is reported by the agent through `usage_update`;
            // there is nothing to pre-seed it from.
            context_window: None,
            hooks: Arc::new(StandardAcpHooks),
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_fixtures::{descriptor, descriptor_json, runnable_binary};
    use super::GenericAcpAdapter;
    use crate::domain::agents::adapter::{
        AgentRuntimeAdapter, RuntimeAccessMode, RuntimePermissionMode, RuntimeSpawnConfig,
        RuntimeUserShellStrategy,
    };
    use crate::domain::agents::providers::installed::installation::HostInstallation;
    use crate::domain::agents::runtime::ProviderStatus;
    use serde_json::json;
    use std::path::Path;
    use std::sync::Arc;

    fn adapter(command: &str) -> GenericAcpAdapter {
        let installation = HostInstallation::from_descriptor(
            descriptor(descriptor_json("acme-agent", command)),
            Path::new("/p/acme-agent.json"),
        )
        .expect("valid descriptor");
        GenericAcpAdapter::new(Arc::new(installation))
    }

    #[test]
    fn catalog_identity_comes_from_the_portable_entry() {
        let dir = tempfile::tempdir().unwrap();
        let entry = adapter(&runnable_binary(dir.path())).catalog_entry();
        assert_eq!(entry.id, "acme-agent");
        assert_eq!(entry.label, "acme-agent agent");
        assert_eq!(entry.status, ProviderStatus::Available);
        assert!(entry.status_message.is_none());
    }

    /// Everything the ACP session negotiates must stay empty in the catalog —
    /// a descriptor may not pre-declare models, modes, or a default model.
    #[test]
    fn negotiated_state_is_absent_from_the_catalog_entry() {
        let dir = tempfile::tempdir().unwrap();
        let entry = adapter(&runnable_binary(dir.path())).catalog_entry();
        assert!(entry.models.is_empty());
        assert!(entry.modes.is_empty());
        assert!(entry.access_modes.is_empty());
        assert!(entry.default_model.is_none());
    }

    #[test]
    fn quarantined_installs_stay_in_the_catalog_as_unavailable() {
        let entry = adapter("/nonexistent/cadencr/acme").catalog_entry();
        assert_eq!(entry.id, "acme-agent");
        assert_eq!(entry.status, ProviderStatus::Unavailable);
        assert!(entry
            .status_message
            .expect("a quarantined install must explain itself")
            .contains("/nonexistent/cadencr/acme"));
    }

    #[tokio::test]
    async fn spawning_a_quarantined_install_fails_with_its_stable_code() {
        let result = adapter("/nonexistent/cadencr/acme")
            .spawn(
                json!("hello"),
                RuntimeSpawnConfig {
                    cwd: std::env::temp_dir(),
                    ..RuntimeSpawnConfig::default()
                },
            )
            .await;
        let Err(error) = result else {
            panic!("a quarantined install must not launch");
        };
        assert!(
            error.to_string().contains("EXECUTABLE_NOT_FOUND"),
            "{error}"
        );
    }

    /// The trait defaults are the honest answers for a generic agent; assert
    /// them so a later edit cannot quietly claim a capability ACP negotiates.
    #[tokio::test]
    async fn declines_every_capability_acp_does_not_guarantee() {
        let dir = tempfile::tempdir().unwrap();
        let adapter = adapter(&runnable_binary(dir.path()));
        assert!(!adapter.is_valid_resume_session_id("ses-1"));
        assert_eq!(adapter.resolve_resume_session_id(Some("ses-1")), None);
        assert!(adapter.session_branching().is_none());
        assert!(adapter.compaction_strategy().is_none());
        assert!(!adapter.supports_builtin_compact_command());
        assert!(!adapter.supports_prompt_receipts());
        assert!(!adapter.supports_runtime_slash_command_refresh());
        assert!(adapter.worktree_config_paths().is_empty());
        assert!(adapter.access_mode_setting_key().is_none());
        assert_eq!(
            adapter.user_shell_strategy(),
            RuntimeUserShellStrategy::Unsupported
        );
        for mode in [
            RuntimePermissionMode::Default,
            RuntimePermissionMode::Plan,
            RuntimePermissionMode::BypassPermissions,
        ] {
            assert!(!adapter.supports_permission_mode(&mode));
        }
        assert!(!adapter.supports_access_mode(&RuntimeAccessMode::FullAccess));
        assert!(adapter.default_model_id().await.is_none());
    }

    #[test]
    fn permission_envelopes_are_parsed_generically() {
        let dir = tempfile::tempdir().unwrap();
        let adapter = adapter(&runnable_binary(dir.path()));
        let parsed = adapter
            .parse_permission_request(&json!({
                "type": "acp_permission_request",
                "request_id": "req-1",
                "tool_name": "Bash",
                "tool_input": { "command": "ls" },
                "options": [{
                    "decision": "allow_once",
                    "option_id": "allow",
                    "label": "Allow",
                    "description": "once",
                    "collect_feedback": false
                }],
            }))
            .expect("standard envelope should parse");
        assert_eq!(parsed.request_id, "req-1");
        assert_eq!(parsed.options.len(), 1);
        assert!(adapter
            .parse_permission_request(&json!({ "type": "other" }))
            .is_none());
    }

    #[tokio::test]
    async fn spawning_without_a_workspace_directory_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let result = adapter(&runnable_binary(dir.path()))
            .spawn(json!("hello"), RuntimeSpawnConfig::default())
            .await;
        let Err(error) = result else {
            panic!("an ACP session needs a cwd");
        };
        assert!(error.to_string().contains("workspace directory"), "{error}");
    }
}
