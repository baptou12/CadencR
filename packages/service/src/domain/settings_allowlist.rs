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
    "model_session",
    "agent_runtime_session",
    "skip_worktree",
    "layout_state",
    "draft_prompt",
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
    "model_session",
    "agent_runtime_session",
    "branch_prefix",
    "default_worktree_mode",
    "color",
    "setup_worktree",
];

/// Keys writable via `PUT /api/workspace/settings/{key}`.
pub const WORKSPACE_ALLOWED_KEYS: &[&str] = &[
    // Active Claude Code env profile name
    "claude_code_active_profile",
    // Onboarding-set CLI binary paths (consumed by `apply_binary_overrides_from_settings`).
    "claude_cli_path",
    "opencode_cli_path",
    "codex_cli_path",
    // Per-provider opt-in for the dangerous "skip every check" mode. The
    // Codex boolean remains writable for old clients; current clients use
    // `codex_permission_mode` instead.
    "claude_bypass_permissions_enabled",
    "codex_full_access_enabled",
    "codex_permission_mode",
    // UI chrome
    "sidebar_left_width",
    "sidebar_collapsed",
    "sidebar_right_collapsed",
    "loader_style",
    // UI zoom is kept per device type: desktop scales via the Electron native
    // zoom factor, mobile (remote browser/PWA) via CSS zoom — independent levels.
    "zoom_global",
    "zoom_mobile",
    "unified_agents_per_row",
    // Active theme (id from packages/desktop/src/lib/themes/registry.ts)
    "theme_current",
    // System-theme sync. When enabled, the frontend resolves the active theme
    // from the current OS appearance plus the two appearance-specific theme ids.
    "theme_follow_system",
    "theme_system_light",
    "theme_system_dark",
    // Editor preferences
    "editor_vim_mode",
    "editor_auto_save",
    "editor_git_blame",
    "editor_max_tabs",
    // File-tree icon set used by the editor's @pierre/trees-based file tree.
    // One of "minimal", "standard", or "complete" — defaulting to "standard"
    // when unset. Stored as a workspace setting because the choice is global,
    // not project- or feature-scoped.
    "editor_file_tree_icon_set",
    "editor_sidebar_collapsed",
    "git_sidebar_collapsed",
    "git_merge_mode",
    // Where agent-finished notifications appear: "native" (system banner),
    // "in_app" (Sonner toast inside Cadencr), or "off". Mirrors
    // NOTIFICATION_MODE_KEY in packages/desktop/src/lib/notification-mode.ts.
    "notification_mode",
    // Workspace-scope agent defaults. `auto_name` is global-only.
    "model_session",
    "model_auto_name",
    "agent_runtime_session",
    "agent_runtime_auto_name",
    // First-run onboarding overlay state.
    // `onboarding_step` is one of the values defined in
    // packages/desktop/src/lib/onboarding-step.ts; missing/unset is treated as
    // step "welcome" by the frontend so existing installs see the overlay
    // until they dismiss or complete it.
    // `default_agent_provider` is set during the onboarding's "pick agent"
    // step (provider id from the agent catalog).
    "onboarding_step",
    "default_agent_provider",
    // Master switch for fluid UI animations. When unset the frontend falls back
    // to the OS `prefers-reduced-motion` media query. Stored as "true" / "false".
    "animations_enabled",
    // Global agent stream verbosity. One of the AGENT_VERBOSITY_MODES values
    // in packages/desktop/src/lib/agent-verbosity.ts (currently "maximal" |
    // "auto_collapse" | "collapsed" | "compact"). The frontend is the source
    // of truth for the set; this allowlist only gates the write endpoint.
    "agent_stream_verbosity_mode",
    // Plays the welcome-step intro animation exactly once, on the very first
    // open of the onboarding overlay. Set to "true" by `WelcomeIntro` after
    // the animation completes (or the user clicks to skip).
    "onboarding_intro_shown",
    // Browser workspace preferences. `browser_default_mode` is "normal" or
    // "private" (see packages/desktop/src/lib/browser-settings.ts) and seeds
    // the Browser tab's first tab + toolbar toggle. `browser_mcp_enabled` is
    // "true"/"false" (default enabled) and gates whether the `cadencr-browser`
    // MCP is attached to agent turns — read in the session-prompt spawn path.
    "browser_default_mode",
    "browser_mcp_enabled",
];

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
        assert!(!is_feature_key_allowed("agent_autonomy"));
        assert!(!is_feature_key_allowed("parallel_execution"));
        assert!(!is_feature_key_allowed("model_qa"));
        assert!(!is_feature_key_allowed("agent_runtime_qa"));
    }

    #[test]
    fn accepts_known_feature_keys() {
        assert!(is_feature_key_allowed("skip_worktree"));
        assert!(is_feature_key_allowed("model_session"));
        assert!(is_feature_key_allowed("layout_state"));
        assert!(is_feature_key_allowed("draft_prompt"));
    }

    #[test]
    fn rejects_retired_bypass_acknowledged_key() {
        // `bypass_acknowledged` was the gate for an old bypass design. The
        // current design gates bypass solely on the workspace-scoped
        // `claude_bypass_permissions_enabled` capability, so the legacy key is
        // no longer read or writable at any scope.
        assert!(!is_feature_key_allowed("bypass_acknowledged"));
        assert!(!is_project_key_allowed("bypass_acknowledged"));
        assert!(!is_workspace_key_allowed("bypass_acknowledged"));
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
    fn project_allows_default_worktree_mode_only() {
        assert!(is_project_key_allowed("default_worktree_mode"));
        assert!(!is_feature_key_allowed("default_worktree_mode"));
        assert!(!is_workspace_key_allowed("default_worktree_mode"));
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
    fn workspace_rejects_retired_per_device_ui_keys() {
        // `active_tab_*`, `editor_sidebar_visible_*`, and `lastOpenedFeature`
        // were per-device UI state; they now live in the frontend's
        // localStorage and are no longer writable at any scope.
        assert!(!is_workspace_key_allowed("editor_sidebar_visible_42"));
        assert!(!is_workspace_key_allowed("active_tab_7"));
        assert!(!is_workspace_key_allowed("lastOpenedFeature"));
    }

    #[test]
    fn workspace_rejects_unknown_static_key() {
        assert!(!is_workspace_key_allowed("arbitrary"));
    }

    #[test]
    fn workspace_accepts_theme_current() {
        // Theme picker writes the active theme id (see
        // packages/desktop/src/lib/themes/registry.ts). Workspace-scoped so it
        // mirrors every other UI-chrome setting.
        assert!(is_workspace_key_allowed("theme_current"));
        assert!(is_workspace_key_allowed("theme_follow_system"));
        assert!(is_workspace_key_allowed("theme_system_light"));
        assert!(is_workspace_key_allowed("theme_system_dark"));
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
    fn workspace_accepts_notification_mode() {
        // Wired to packages/desktop/src/lib/notification-mode.ts —
        // the Settings → Notifications picker writes "native" / "in_app" / "off".
        // Without this, useDebouncedSetting toasts "Could not save setting".
        assert!(is_workspace_key_allowed("notification_mode"));
        assert!(!is_feature_key_allowed("notification_mode"));
        assert!(!is_project_key_allowed("notification_mode"));
    }

    #[test]
    fn workspace_accepts_ui_collapse_settings() {
        assert!(is_workspace_key_allowed("editor_sidebar_collapsed"));
        assert!(is_workspace_key_allowed("git_sidebar_collapsed"));
        assert!(is_workspace_key_allowed("unified_agents_per_row"));
    }

    #[test]
    fn workspace_accepts_per_device_zoom_keys() {
        // Desktop and mobile persist independent zoom levels under separate keys;
        // without both, the FE gets a BAD_REQUEST and zoom silently fails to save.
        assert!(is_workspace_key_allowed("zoom_global"));
        assert!(is_workspace_key_allowed("zoom_mobile"));
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
        assert!(is_workspace_key_allowed("codex_permission_mode"));
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
    fn workspace_accepts_agent_stream_verbosity_mode() {
        // Persisted by the global Settings page → "Agent output verbosity"
        // picker via useDebouncedSetting. Without this, switching modes
        // returns 400 and the FE toast "Could not save setting".
        assert!(is_workspace_key_allowed("agent_stream_verbosity_mode"));
        assert!(!is_feature_key_allowed("agent_stream_verbosity_mode"));
        assert!(!is_project_key_allowed("agent_stream_verbosity_mode"));
    }

    #[test]
    fn workspace_accepts_animations_enabled() {
        // Master switch for fluid UI animations, persisted from the Welcome
        // onboarding step and the Settings → Appearance toggle.
        assert!(is_workspace_key_allowed("animations_enabled"));
        assert!(!is_feature_key_allowed("animations_enabled"));
        assert!(!is_project_key_allowed("animations_enabled"));
    }

    #[test]
    fn workspace_accepts_editor_file_tree_icon_set() {
        // The Settings → Appearance picker writes "minimal" / "standard" /
        // "complete" via useDebouncedSetting → PUT /api/workspace/settings/{key}.
        assert!(is_workspace_key_allowed("editor_file_tree_icon_set"));
        assert!(!is_feature_key_allowed("editor_file_tree_icon_set"));
        assert!(!is_project_key_allowed("editor_file_tree_icon_set"));
    }

    #[test]
    fn workspace_accepts_browser_settings() {
        // Browser tab default mode + the cadencr-browser MCP master switch are
        // global UI/agent prefs, so they live on the workspace scope only.
        assert!(is_workspace_key_allowed("browser_default_mode"));
        assert!(is_workspace_key_allowed("browser_mcp_enabled"));
        assert!(!is_feature_key_allowed("browser_mcp_enabled"));
        assert!(!is_project_key_allowed("browser_mcp_enabled"));
    }

    #[test]
    fn workspace_accepts_agent_defaults() {
        // These flow through the global Settings page + useDebouncedSetting.
        for k in [
            "model_session",
            "model_auto_name",
            "agent_runtime_session",
            "agent_runtime_auto_name",
            "sidebar_right_collapsed",
        ] {
            assert!(is_workspace_key_allowed(k), "{k} should be allowed");
        }
    }
}
