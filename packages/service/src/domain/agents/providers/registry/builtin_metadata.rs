use std::borrow::Cow;
use std::path::PathBuf;

use cli_discovery::DiscoverySpec;

use super::{ProviderDiscoveryMetadata, ProviderRegistrationMetadata};

pub(super) fn claude_metadata() -> ProviderRegistrationMetadata {
    ProviderRegistrationMetadata {
        aliases: aliases(&["claude", "claude-code", "Claude Code", "anthropic"]),
        model_guidance: Some(Cow::Borrowed(
            "Use catalog aliases such as opus, opus[1m], sonnet, haiku, or default.",
        )),
        discovery: Some(discovery(
            "claude",
            "claude_cli_path",
            claude_agent_sdk_rs::claude_discovery_spec(),
            claude_agent_sdk_rs::set_binary_override,
        )),
    }
}

pub(super) fn codex_metadata() -> ProviderRegistrationMetadata {
    ProviderRegistrationMetadata {
        aliases: aliases(&["codex", "codex-cli", "Codex CLI", "openai"]),
        model_guidance: Some(Cow::Borrowed(
            "Use bare Codex/OpenAI-style model ids advertised by the Codex app-server, for example gpt-5.5.",
        )),
        discovery: Some(discovery(
            "codex",
            "codex_cli_path",
            codex_app_server_sdk_rs::codex_discovery_spec(),
            codex_app_server_sdk_rs::set_binary_override,
        )),
    }
}

pub(super) fn cursor_metadata() -> ProviderRegistrationMetadata {
    ProviderRegistrationMetadata {
        model_guidance: Some(Cow::Borrowed(
            "Use model ids advertised by the Cursor Agent CLI, for example values returned by `agent models`.",
        )),
        discovery: Some(discovery(
            "cursor",
            "cursor_cli_path",
            cursor_agent_sdk_rs::cursor_discovery_spec(),
            cursor_agent_sdk_rs::set_binary_override,
        )),
        ..ProviderRegistrationMetadata::default()
    }
}

#[cfg(test)]
mod tests {
    use super::cursor_metadata;

    #[test]
    fn cursor_model_guidance_points_to_the_cli_catalog() {
        let metadata = cursor_metadata();
        assert!(metadata
            .model_guidance()
            .is_some_and(|guidance| guidance.contains("agent models")));
    }
}

pub(super) fn opencode_metadata() -> ProviderRegistrationMetadata {
    ProviderRegistrationMetadata {
        aliases: aliases(&["open-code", "OpenCode", "open"]),
        model_guidance: Some(Cow::Borrowed(
            "Use OpenCode provider/model ids such as default/default or other ids shown by OpenCode's model catalog.",
        )),
        discovery: Some(discovery(
            "opencode",
            "opencode_cli_path",
            opencode_sdk_rs::opencode_discovery_spec(),
            opencode_sdk_rs::set_binary_override,
        )),
    }
}

fn aliases(values: &'static [&'static str]) -> Vec<Cow<'static, str>> {
    values.iter().copied().map(Cow::Borrowed).collect()
}

fn discovery(
    discovery_id: &'static str,
    setting_key: &'static str,
    spec: DiscoverySpec,
    apply_override: fn(Option<PathBuf>),
) -> ProviderDiscoveryMetadata {
    ProviderDiscoveryMetadata {
        discovery_id: Cow::Borrowed(discovery_id),
        setting_key: Cow::Borrowed(setting_key),
        spec,
        apply_override,
    }
}
