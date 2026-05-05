//! Allowlists for HTTP settings-write endpoints.
//!
//! Each `PUT /api/{features,projects,workspace}/.../settings` route consults
//! the matching function here before delegating to the repository. An unknown
//! key returns 400 so a compromised agent can't write keys the server manages
//! on its own (e.g. `worktree_path`) or keys that are documented-intent RCE
//! (e.g. `setup_worktree` on the feature scope).
//!
//! The write path is the only enforcement point. Legacy DB rows with unknown
//! keys are harmless — reads still work, and if an old key is no longer
//! writable that just means the UI that used to write it has moved on.

/// Keys writable via `PUT /api/features/{id}/settings`. Covers the real
/// columns on the `features` table plus a small set of EAV keys the frontend
/// writes into `feature_settings`.
pub const FEATURE_ALLOWED_KEYS: &[&str] = &[
    "model_plan",
    "model_prd",
    "model_execute",
    "model_risk",
    "model_review",
    "model_review-fixer",
    "model_session",
    "model_qa",
    "model_retro",
    "model_workflow",
    "agent_runtime_plan",
    "agent_runtime_prd",
    "agent_runtime_execute",
    "agent_runtime_risk",
    "agent_runtime_review",
    "agent_runtime_review-fixer",
    "agent_runtime_session",
    "agent_runtime_qa",
    "agent_runtime_retro",
    "agent_autonomy",
    "parallel_execution",
    "skip_worktree",
    "bypass_acknowledged",
    "layout_state",
    // Git workflow (per-feature). `worktree_mode` selects how the worktree is
    // provisioned at feature creation: "new" (default), "reuse" (attach to an
    // existing branch / its worktree), or "skip". `worktree_reuse_branch`
    // carries the branch name when mode = "reuse". `worktree_base_branch`
    // (mode = "new" only) overrides the source branch the new worktree forks
    // from — defaults to the project's current HEAD when unset.
    // `target_branch` overrides the auto-detected compare target.
    // `git_view_mode` persists the Git tab segmented control: "uncommitted"
    // or "vs-target".
    "worktree_mode",
    "worktree_reuse_branch",
    "worktree_base_branch",
    "target_branch",
    "git_view_mode",
];

/// Keys writable via `PUT /api/projects/{id}/settings`.
pub const PROJECT_ALLOWED_KEYS: &[&str] = &[
    "model_plan",
    "model_prd",
    "model_execute",
    "model_risk",
    "model_review",
    "model_review-fixer",
    "model_session",
    "model_qa",
    "model_retro",
    "model_workflow",
    "agent_runtime_plan",
    "agent_runtime_prd",
    "agent_runtime_execute",
    "agent_runtime_risk",
    "agent_runtime_review",
    "agent_runtime_review-fixer",
    "agent_runtime_session",
    "agent_runtime_qa",
    "agent_runtime_retro",
    "agent_autonomy",
    "parallel_execution",
    "branch_prefix",
    "qa_prompt",
    "color",
    "setup_worktree",
    "bypass_acknowledged",
];

/// Keys writable via `PUT /api/workspace/settings/{key}`.
pub const WORKSPACE_ALLOWED_KEYS: &[&str] = &[
    // Active Claude Code env profile name
    "claude_code_active_profile",
    // Onboarding-set CLI binary paths (consumed by `apply_binary_overrides_from_settings`).
    "claude_cli_path",
    "opencode_cli_path",
    "codex_cli_path",
    // Per-provider opt-in for the dangerous "skip every check" mode. Mirrored
    // by CLAUDE_BYPASS_PERMISSIONS_SETTING_KEY / CODEX_FULL_ACCESS_SETTING_KEY
    // in packages/tauri/src/shared/permission-mode-settings.ts. Stored as
    // "true" / "false"; when "true" the matching mode joins the Shift+Tab
    // cycle for that provider's chip.
    "claude_bypass_permissions_enabled",
    "codex_full_access_enabled",
    // Last-session restoration
    "lastOpenedFeature",
    // UI chrome
    "sidebar_left_width",
    "sidebar_collapsed",
    "sidebar_right_collapsed",
    "loader_style",
    "zoom_global",
    "unified_agents_per_row",
    // Active theme (id from packages/tauri/src/lib/themes/registry.ts)
    "theme_current",
    // Editor preferences
    "editor_vim_mode",
    "editor_auto_save",
    "editor_git_blame",
    "editor_max_tabs",
    "editor_sidebar_collapsed",
    "git_sidebar_collapsed",
    "git_merge_mode",
    // Workspace-scope agent defaults (mirror the per-project / per-feature keys)
    "agent_autonomy",
    "parallel_execution",
    "model_plan",
    "model_prd",
    "model_execute",
    "model_risk",
    "model_review",
    "model_review-fixer",
    "model_session",
    "model_qa",
    "model_retro",
    "model_workflow",
    "model_auto_name",
    "model_brainstorm",
    "agent_runtime_plan",
    "agent_runtime_prd",
    "agent_runtime_execute",
    "agent_runtime_risk",
    "agent_runtime_review",
    "agent_runtime_review-fixer",
    "agent_runtime_session",
    "agent_runtime_qa",
    "agent_runtime_retro",
    "agent_runtime_auto_name",
    "agent_runtime_brainstorm",
    // First-run onboarding overlay state.
    // `onboarding_step` is one of the values defined in
    // packages/tauri/src/lib/onboarding-step.ts; missing/unset is treated as
    // step "welcome" by the frontend so existing installs see the overlay
    // until they dismiss or complete it.
    // `default_agent_provider` is set during the onboarding's "pick agent"
    // step (provider id from the agent catalog).
    "onboarding_step",
    "default_agent_provider",
    // Plays the welcome-step intro animation exactly once, on the very first
    // open of the onboarding overlay. Set to "true" by `WelcomeIntro` after
    // the animation completes (or the user clicks to skip).
    "onboarding_intro_shown",
];

/// Prefixes for per-feature workspace keys whose suffix is a feature id. Must
/// match the patterns used by `useDebouncedSetting` in the frontend.
const WORKSPACE_NUMERIC_PREFIXES: &[&str] = &["editor_sidebar_visible_", "active_tab_"];

/// Prefixes whose suffix is a free-form provider/model identifier. Suffix
/// characters are restricted to ASCII alphanumerics plus `._-` to keep the
/// allowlist tight while accepting real model ids like `claude-sonnet-4-5` or
/// `claude_code_claude-opus-4`.
const WORKSPACE_MODEL_PREFIXES: &[&str] = &["thinking_effort_model_"];

pub fn is_feature_key_allowed(key: &str) -> bool {
    FEATURE_ALLOWED_KEYS.contains(&key)
}

pub fn is_project_key_allowed(key: &str) -> bool {
    PROJECT_ALLOWED_KEYS.contains(&key)
}

pub fn is_workspace_key_allowed(key: &str) -> bool {
    if WORKSPACE_ALLOWED_KEYS.contains(&key) {
        return true;
    }
    if WORKSPACE_NUMERIC_PREFIXES.iter().any(|p| {
        key.strip_prefix(p)
            .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()))
    }) {
        return true;
    }
    WORKSPACE_MODEL_PREFIXES.iter().any(|p| {
        key.strip_prefix(p).is_some_and(|rest| {
            !rest.is_empty()
                && rest
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_feature_key() {
        assert!(!is_feature_key_allowed("setup_worktree"));
        assert!(!is_feature_key_allowed("worktree_path"));
        assert!(!is_feature_key_allowed("arbitrary_injected_key"));
    }

    #[test]
    fn accepts_known_feature_keys() {
        assert!(is_feature_key_allowed("agent_autonomy"));
        assert!(is_feature_key_allowed("parallel_execution"));
        assert!(is_feature_key_allowed("bypass_acknowledged"));
        assert!(is_feature_key_allowed("skip_worktree"));
        assert!(is_feature_key_allowed("model_plan"));
        assert!(is_feature_key_allowed("layout_state"));
    }

    #[test]
    fn rejects_legacy_thinking_effort_keys_everywhere() {
        // Per-agent-type thinking effort settings were removed in favour of
        // per-model workspace defaults. Old keys should no longer be writable
        // at any scope.
        for k in [
            "thinking_effort_session",
            "thinking_effort_plan",
            "thinking_effort_qa",
            "thinking_effort_auto_name",
        ] {
            assert!(
                !is_feature_key_allowed(k),
                "{k} must be rejected on feature"
            );
            assert!(
                !is_project_key_allowed(k),
                "{k} must be rejected on project"
            );
            assert!(
                !is_workspace_key_allowed(k),
                "{k} must be rejected on workspace"
            );
        }
    }

    #[test]
    fn project_allows_setup_worktree_but_feature_does_not() {
        assert!(is_project_key_allowed("setup_worktree"));
        assert!(!is_feature_key_allowed("setup_worktree"));
    }

    #[test]
    fn feature_allows_git_workflow_keys() {
        // Mirror how `skip_worktree` is scoped: writable on feature only.
        for k in [
            "worktree_mode",
            "worktree_reuse_branch",
            "worktree_base_branch",
            "target_branch",
            "git_view_mode",
        ] {
            assert!(
                is_feature_key_allowed(k),
                "{k} should be allowed on feature"
            );
            assert!(
                !is_project_key_allowed(k),
                "{k} must be rejected on project"
            );
            assert!(
                !is_workspace_key_allowed(k),
                "{k} must be rejected on workspace"
            );
        }
    }

    #[test]
    fn rejects_worktree_path_everywhere() {
        assert!(!is_feature_key_allowed("worktree_path"));
        assert!(!is_project_key_allowed("worktree_path"));
        assert!(!is_workspace_key_allowed("worktree_path"));
        assert!(!is_feature_key_allowed("worktree_branch"));
        assert!(!is_feature_key_allowed("worktree_setup_step"));
        assert!(!is_feature_key_allowed("worktree_setup_log"));
    }

    #[test]
    fn workspace_accepts_dynamic_feature_keys() {
        assert!(is_workspace_key_allowed("editor_sidebar_visible_42"));
        assert!(is_workspace_key_allowed("active_tab_7"));
    }

    #[test]
    fn workspace_rejects_malformed_dynamic_keys() {
        assert!(!is_workspace_key_allowed("editor_sidebar_visible_"));
        assert!(!is_workspace_key_allowed("active_tab_abc"));
        assert!(!is_workspace_key_allowed("active_tab_1;drop"));
    }

    #[test]
    fn workspace_rejects_unknown_static_key() {
        assert!(!is_workspace_key_allowed("arbitrary"));
    }

    #[test]
    fn workspace_accepts_theme_current() {
        // Theme picker writes the active theme id (see
        // packages/tauri/src/lib/themes/registry.ts). Workspace-scoped so it
        // mirrors every other UI-chrome setting.
        assert!(is_workspace_key_allowed("theme_current"));
    }

    #[test]
    fn workspace_accepts_per_model_thinking_effort_keys() {
        assert!(is_workspace_key_allowed(
            "thinking_effort_model_claude_code_claude-opus-4"
        ));
        assert!(is_workspace_key_allowed(
            "thinking_effort_model_claude_code_claude-sonnet-4-5"
        ));
        assert!(is_workspace_key_allowed("thinking_effort_model_opencode_x"));
        assert!(is_workspace_key_allowed(
            "thinking_effort_model_provider_model.v2"
        ));
    }

    #[test]
    fn workspace_rejects_malformed_per_model_thinking_effort_keys() {
        assert!(!is_workspace_key_allowed("thinking_effort_model_"));
        assert!(!is_workspace_key_allowed("thinking_effort_model_a/b"));
        assert!(!is_workspace_key_allowed("thinking_effort_model_a;drop"));
        assert!(!is_workspace_key_allowed("thinking_effort_model_a b"));
    }

    #[test]
    fn workspace_accepts_ui_collapse_settings() {
        assert!(is_workspace_key_allowed("editor_sidebar_collapsed"));
        assert!(is_workspace_key_allowed("git_sidebar_collapsed"));
        assert!(is_workspace_key_allowed("unified_agents_per_row"));
    }

    #[test]
    fn workspace_accepts_dangerous_mode_toggles() {
        // DangerousModeToggle persists these via useDebouncedSetting → PUT
        // /api/workspace/settings/{key}. Without these, the FE gets a
        // BAD_REQUEST and the toggle silently fails to enable.
        assert!(is_workspace_key_allowed(
            "claude_bypass_permissions_enabled"
        ));
        assert!(is_workspace_key_allowed("codex_full_access_enabled"));
    }

    #[test]
    fn workspace_accepts_onboarding_keys() {
        // Used by the first-run OnboardingOverlay to persist the current step
        // and the default agent provider chosen by the user.
        assert!(is_workspace_key_allowed("onboarding_step"));
        assert!(is_workspace_key_allowed("default_agent_provider"));
        assert!(is_workspace_key_allowed("onboarding_intro_shown"));
    }

    #[test]
    fn workspace_accepts_agent_defaults() {
        // These flow through the global Settings page + useDebouncedSetting.
        for k in [
            "agent_autonomy",
            "parallel_execution",
            "model_plan",
            "model_execute",
            "agent_runtime_session",
            "agent_runtime_auto_name",
            "sidebar_right_collapsed",
        ] {
            assert!(is_workspace_key_allowed(k), "{k} should be allowed");
        }
    }
}
