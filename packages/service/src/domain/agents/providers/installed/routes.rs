//! `GET /api/agents/installed-providers` — what the startup scan found.
//!
//! Rejections and quarantines have to be visible somewhere the user can reach.
//! A rejected descriptor never gets a catalog entry (registering an id we could
//! not verify is exactly what rejection prevents), so without this endpoint the
//! only trace would be a log line the user never sees. Quarantined installs do
//! reach the catalog, as unavailable — they are repeated here so both failure
//! shapes are readable from one place.
//!
//! Environment values are deliberately absent from the response: they are host
//! launch policy and may carry secrets.

use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::app_state::AppState;
use crate::domain::agents::providers::provider_registry;

use super::installation::HostInstallation;
use super::rejection::DescriptorRejection;
use super::startup_load;

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub struct InstalledProvidersResponse {
    /// Directory the descriptors were read from. Present even when empty so the
    /// user knows where to put one.
    pub directory: String,
    pub installed: Vec<InstalledProviderEntry>,
    pub rejected: Vec<InstalledProviderRejection>,
}

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub struct InstalledProviderEntry {
    /// Catalog id, owned by the portable ACP registry entry.
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub source_path: String,
    pub enabled: bool,
    /// Whether the provider actually joined the runtime registry this boot.
    pub registered: bool,
    /// Stable SCREAMING_SNAKE code when the install cannot launch; `null` when
    /// it can. This is the only availability signal — the catalog's
    /// `unavailable` status is derived from the same fact.
    pub quarantine_code: Option<String>,
    /// Why the install cannot launch, when it cannot.
    pub quarantine_message: Option<String>,
    /// The resolved program. The argument vector is deliberately absent: an
    /// argument can carry a credential (`--token …`) and, unlike a fixed set of
    /// env names, there is no generic way to redact one safely.
    pub executable: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub struct InstalledProviderRejection {
    pub source_path: String,
    /// The id the descriptor claimed, when it parsed far enough to claim one.
    pub provider_id: Option<String>,
    /// Stable SCREAMING_SNAKE code.
    pub code: String,
    pub message: String,
}

#[utoipa::path(
    get,
    path = "/api/agents/installed-providers",
    responses((status = 200, body = InstalledProvidersResponse))
)]
pub async fn installed_providers_handler() -> Json<InstalledProvidersResponse> {
    // The registry is what actually registered these installs, so ask it rather
    // than re-deriving which ones made it in.
    let registry = provider_registry();
    let outcome = startup_load();
    Json(InstalledProvidersResponse {
        directory: outcome.directory.display().to_string(),
        installed: outcome
            .installations
            .iter()
            .map(|installation| entry(installation, registry.contains(installation.provider_id())))
            .collect(),
        rejected: outcome.rejections.iter().map(rejection).collect(),
    })
}

fn entry(installation: &HostInstallation, registered: bool) -> InstalledProviderEntry {
    let agent = installation.agent();
    let quarantine = installation.quarantine();
    InstalledProviderEntry {
        id: agent.id.clone(),
        name: agent.name.clone(),
        version: agent.version.clone(),
        description: agent.description.clone(),
        source_path: installation.source_path().display().to_string(),
        enabled: installation.enabled(),
        registered,
        quarantine_code: quarantine.map(|quarantine| quarantine.code.as_str().to_string()),
        quarantine_message: quarantine.map(|quarantine| quarantine.message.clone()),
        executable: installation.executable().command.display().to_string(),
    }
}

fn rejection(rejection: &DescriptorRejection) -> InstalledProviderRejection {
    InstalledProviderRejection {
        source_path: rejection.source_path.display().to_string(),
        provider_id: rejection.provider_id.clone(),
        code: rejection.code.as_str().to_string(),
        message: rejection.message.clone(),
    }
}

pub fn installed_providers_router() -> Router<AppState> {
    Router::new().route(
        "/api/agents/installed-providers",
        get(installed_providers_handler),
    )
}

#[cfg(test)]
mod tests {
    use super::{entry, rejection};
    use crate::domain::agents::providers::installed::descriptor::ProviderDescriptor;
    use crate::domain::agents::providers::installed::installation::HostInstallation;
    use crate::domain::agents::providers::installed::rejection::{
        DescriptorRejection, RejectionCode,
    };
    use serde_json::json;
    use std::path::Path;

    fn installation(command: &str) -> HostInstallation {
        let descriptor: ProviderDescriptor = serde_json::from_value(json!({
            "schema_version": 1,
            "agent": {
                "id": "acme-agent",
                "name": "Acme Agent",
                "version": "2.1.0",
                "description": "an ACP agent",
            },
            "installation": {
                "executable": {
                    "command": command,
                    "args": ["acp", "--token", "argument-secret"],
                    "env": { "ACME_TOKEN": "super-secret" },
                },
            },
        }))
        .unwrap();
        HostInstallation::from_descriptor(descriptor, Path::new("/p/acme-agent.json"))
            .expect("valid descriptor")
    }

    #[test]
    fn quarantined_installs_report_their_stable_code() {
        let response = entry(&installation("/nonexistent/cadencr/acme"), false);
        assert_eq!(response.id, "acme-agent");
        assert_eq!(response.version, "2.1.0");
        assert_eq!(
            response.quarantine_code.as_deref(),
            Some("EXECUTABLE_NOT_FOUND")
        );
        assert!(response
            .quarantine_message
            .as_deref()
            .is_some_and(|message| message.contains("/nonexistent/cadencr/acme")));
        assert!(!response.registered);
        assert_eq!(response.executable, "/nonexistent/cadencr/acme");
    }

    /// Launch inputs that can hold credentials — environment values and the
    /// argument vector — must not appear anywhere in the serialized entry.
    #[test]
    fn credential_bearing_launch_inputs_never_reach_the_response() {
        let response = entry(&installation("/nonexistent/cadencr/acme"), false);
        let serialized = serde_json::to_string(&response).unwrap();
        for secret in ["super-secret", "ACME_TOKEN", "--token", "argument-secret"] {
            assert!(!serialized.contains(secret), "{secret} in {serialized}");
        }
    }

    #[test]
    fn rejections_carry_their_code_and_reason() {
        let response = rejection(
            &DescriptorRejection::new(
                Path::new("/p/acme-agent.json"),
                RejectionCode::DuplicateProviderId,
                "already registered",
            )
            .with_provider_id("acme-agent"),
        );
        assert_eq!(response.code, "DUPLICATE_PROVIDER_ID");
        assert_eq!(response.provider_id.as_deref(), Some("acme-agent"));
        assert_eq!(response.message, "already registered");
    }
}
