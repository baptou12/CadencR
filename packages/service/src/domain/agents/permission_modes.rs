use super::adapter::RuntimePermissionMode;
use super::runtime_adapter;

/// Parse a permission mode string from the client into a PermissionMode enum value.
pub(crate) fn parse_permission_mode(mode: &str) -> RuntimePermissionMode {
    match mode {
        "acceptEdits" => RuntimePermissionMode::AcceptEdits,
        "bypassPermissions" => RuntimePermissionMode::BypassPermissions,
        "plan" => RuntimePermissionMode::Plan,
        "auto" => RuntimePermissionMode::Auto,
        "dontAsk" => RuntimePermissionMode::DontAsk,
        _ => RuntimePermissionMode::Default,
    }
}

pub(crate) fn permission_mode_wire(mode: &RuntimePermissionMode) -> &'static str {
    match mode {
        RuntimePermissionMode::Default => "default",
        RuntimePermissionMode::AcceptEdits => "acceptEdits",
        RuntimePermissionMode::BypassPermissions => "bypassPermissions",
        RuntimePermissionMode::Plan => "plan",
        RuntimePermissionMode::Auto => "auto",
        RuntimePermissionMode::DontAsk => "dontAsk",
    }
}

/// Whether a given runtime provider can run a given permission mode.
/// Dispatches to the adapter so the (provider, mode) matrix lives next to
/// each adapter's CLI-arg mapping rather than as a switch in shared code.
/// Mirrored on the frontend by `lib/provider-modes.ts`. Unknown providers
/// default to allowing the request — a new adapter must be wired into the
/// registry before its mode policy can be enforced anyway.
pub(crate) fn provider_supports_mode(provider: &str, mode: &RuntimePermissionMode) -> bool {
    runtime_adapter(provider)
        .map(|adapter| adapter.supports_permission_mode(mode))
        .unwrap_or(true)
}

/// Wire string the chip should land on after a session switches to this
/// provider. Mirrors `defaultEditModeFor` in `lib/provider-modes.ts`.
pub(crate) fn default_permission_mode_wire(provider: &str) -> &'static str {
    runtime_adapter(provider)
        .map(|adapter| adapter.default_permission_mode_wire())
        .unwrap_or("acceptEdits")
}

/// Parsed counterpart of [`default_permission_mode_wire`]. Use this from
/// runtime-spawn paths that need a `RuntimePermissionMode`; the wire variant
/// stays for DB persistence and `mode.changed` broadcasts.
pub(crate) fn default_permission_mode(provider: &str) -> RuntimePermissionMode {
    parse_permission_mode(default_permission_mode_wire(provider))
}

/// Wire string the chip should land on after a plan is approved
/// (post-`ExitPlanMode`). Dispatches to the adapter so the per-provider
/// matrix lives next to the rest of each adapter's mode policy. Mirrored on
/// the frontend by `postPlanApprovalModeFor` in `lib/provider-modes.ts`.
pub(crate) fn post_plan_approval_mode_wire(provider: &str, model: Option<&str>) -> &'static str {
    runtime_adapter(provider)
        .map(|adapter| adapter.post_plan_approval_mode_wire(model))
        .unwrap_or("acceptEdits")
}

/// If the post-plan target mode was rejected by the CLI, return the
/// fallback wire string the orchestrator should retry with. `None` means
/// surface the original rejection.
pub(crate) fn post_plan_approval_fallback_mode_wire(
    provider: &str,
    failed_mode_wire: &str,
) -> Option<&'static str> {
    runtime_adapter(provider)
        .and_then(|adapter| adapter.post_plan_approval_fallback_mode_wire(failed_mode_wire))
}
