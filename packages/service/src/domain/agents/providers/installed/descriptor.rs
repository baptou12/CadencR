//! The portable ACP Registry agent entry and the Cadencr host envelope around
//! it.
//!
//! Two deliberately separate things live here:
//!
//! - [`AcpAgentEntry`] is the **portable** payload. It mirrors the ACP Registry
//!   entry format (`agent.schema.json`: `id`, `name`, `version`, `description`,
//!   `repository`, `website`, `authors`, `license`, `icon`, `distribution`) and
//!   keeps every unrecognised field in `extra`, so an entry can round-trip
//!   through Cadencr without losing data it does not consume yet.
//! - [`ProviderDescriptor`] is the **host** envelope: a Cadencr `schema_version`
//!   plus the host-local [`HostInstallationSpec`] (enablement and the resolved
//!   local executable). Nothing in the envelope belongs in the portable payload,
//!   and the portable payload never carries host policy.
//!
//! Capabilities are not modelled here on purpose. Models, modes, permission
//! maps, and authentication are owned by the ACP protocol and discovered
//! through `initialize` / `session/new`; inventing descriptor booleans for them
//! would make a marketplace field authoritative over the negotiated session.
//! See `docs/PROVIDER_SPEC/BOUNDARIES.md` ("Do not guess capabilities from
//! executable names, versions, tool names, or provider IDs").

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::rejection::{DescriptorError, RejectionCode};

/// Host envelope versions this build understands.
pub const SUPPORTED_SCHEMA_VERSION: u32 = 1;

/// Platform keys the ACP Registry `distribution.binary` map is allowed to use.
pub const ACP_BINARY_TARGETS: &[&str] = &[
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-aarch64",
    "linux-x86_64",
    "windows-aarch64",
    "windows-x86_64",
];

/// Field names the ACP handshake owns.
///
/// A descriptor carrying one of these reads as if it configured the agent, but
/// cannot: `initialize` and `session/new` are authoritative, so the value would
/// be silently ignored. Refusing the file is the honest outcome — a silently
/// dropped `"models"` key is exactly the capability inversion
/// `docs/PROVIDER_SPEC/BOUNDARIES.md` forbids. Compared after stripping case
/// and separators, so `authMethods` and `auth_methods` are both caught.
///
/// Deliberately only the plural nouns the boundary rule itself names. Guessing
/// at singulars (`mode`, `model`, `permission`) would refuse entries over words
/// the registry may one day use for something else entirely.
const PROTOCOL_OWNED_FIELDS: &[&str] = &[
    "accessmodes",
    "auth",
    "authmethods",
    "capabilities",
    "defaultmodel",
    "models",
    "modes",
    "permissionmodes",
    "permissions",
    "slashcommands",
    "thinkinglevels",
];

/// One descriptor file: a Cadencr host envelope wrapping a portable entry.
///
/// The envelope is host-owned, so an unknown key here is a mistake rather than
/// a field from a newer registry: refuse it instead of ignoring it.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderDescriptor {
    pub schema_version: u32,
    pub agent: AcpAgentEntry,
    #[serde(default)]
    pub installation: HostInstallationSpec,
}

/// ACP Registry agent entry. Field names and shapes follow
/// <https://github.com/agentclientprotocol/registry> `agent.schema.json`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AcpAgentEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub website: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub authors: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Optional here, required by the registry schema: a hand-written local
    /// install has nothing to download. When present it is validated in full so
    /// the entry stays exportable to the registry unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distribution: Option<AcpDistribution>,
    /// Every field this build does not model, preserved verbatim.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct AcpDistribution {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary: Option<BTreeMap<String, AcpBinaryTarget>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub npx: Option<AcpPackageDistribution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uvx: Option<AcpPackageDistribution>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AcpBinaryTarget {
    pub archive: String,
    pub cmd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AcpPackageDistribution {
    pub package: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
}

/// Host-local installation policy. Never part of the portable entry.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HostInstallationSpec {
    /// A disabled install stays on disk and stays visible, but does not join
    /// the runtime registry.
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
    /// The explicitly selected local executable. Required in this build:
    /// downloading a distribution is a later increment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable: Option<LocalExecutableSpec>,
}

impl Default for HostInstallationSpec {
    fn default() -> Self {
        Self {
            enabled: true,
            executable: None,
        }
    }
}

fn enabled_by_default() -> bool {
    true
}

/// A launch target: program plus argument vector. Never a shell string —
/// marketplace data must not be interpolated into a command line.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LocalExecutableSpec {
    pub command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    /// Literal environment applied to the child. Mirrors the ACP distribution
    /// `env` shape. Values are redacted from logs and never leave the service.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
}

impl ProviderDescriptor {
    /// Validate the envelope and the portable entry it carries.
    pub fn validate(&self) -> Result<(), DescriptorError> {
        if self.schema_version != SUPPORTED_SCHEMA_VERSION {
            return Err(DescriptorError::new(
                RejectionCode::UnsupportedSchemaVersion,
                format!(
                    "descriptor schema_version {} is not supported by this build (expected {})",
                    self.schema_version, SUPPORTED_SCHEMA_VERSION
                ),
            ));
        }
        self.agent.validate()
    }
}

impl AcpAgentEntry {
    /// Enforce the ACP Registry agent entry rules Cadencr can check offline.
    pub fn validate(&self) -> Result<(), DescriptorError> {
        if !is_registry_id(&self.id) {
            return Err(schema_violation(format!(
                "agent id {:?} must match the ACP registry pattern ^[a-z][a-z0-9-]*$",
                self.id
            )));
        }
        if self.name.trim().is_empty() {
            return Err(schema_violation("agent name must not be empty"));
        }
        if self.description.trim().is_empty() {
            return Err(schema_violation("agent description must not be empty"));
        }
        if !is_semver_prefixed(&self.version) {
            return Err(schema_violation(format!(
                "agent version {:?} must start with a semantic version (MAJOR.MINOR.PATCH)",
                self.version
            )));
        }
        if let Some(key) = self.extra.keys().find(|key| is_protocol_owned_field(key)) {
            return Err(schema_violation(format!(
                "agent field {key:?} describes a capability the ACP handshake owns; \
                 remove it — models, modes, permissions, and auth come from \
                 initialize and session/new, never from a descriptor"
            )));
        }
        match &self.distribution {
            Some(distribution) => distribution.validate(),
            None => Ok(()),
        }
    }
}

impl AcpDistribution {
    fn validate(&self) -> Result<(), DescriptorError> {
        let no_binary = self.binary.as_ref().is_none_or(BTreeMap::is_empty);
        if no_binary && self.npx.is_none() && self.uvx.is_none() {
            return Err(schema_violation(
                "agent distribution must declare at least one of binary, npx, or uvx",
            ));
        }
        for (platform, target) in self.binary.iter().flatten() {
            if !ACP_BINARY_TARGETS.contains(&platform.as_str()) {
                return Err(schema_violation(format!(
                    "unknown binary distribution target {platform:?}"
                )));
            }
            target.validate(platform)?;
        }
        for (label, package) in [("npx", &self.npx), ("uvx", &self.uvx)] {
            if let Some(package) = package {
                if package.package.trim().is_empty() {
                    return Err(schema_violation(format!(
                        "{label} distribution package must not be empty"
                    )));
                }
            }
        }
        Ok(())
    }

    /// Whether the entry declares a way to run on this OS/architecture.
    ///
    /// Package distributions are platform-independent, so declaring one is
    /// enough. A binary-only entry must name this host's target.
    pub fn supports_current_platform(&self) -> bool {
        if self.npx.is_some() || self.uvx.is_some() {
            return true;
        }
        match (&self.binary, current_binary_target()) {
            (Some(binary), Some(target)) => binary.contains_key(target),
            _ => false,
        }
    }
}

impl AcpBinaryTarget {
    fn validate(&self, platform: &str) -> Result<(), DescriptorError> {
        if self.archive.trim().is_empty() {
            return Err(schema_violation(format!(
                "binary target {platform} is missing an archive URL"
            )));
        }
        if self.cmd.trim().is_empty() {
            return Err(schema_violation(format!(
                "binary target {platform} is missing a cmd"
            )));
        }
        if let Some(sha256) = &self.sha256 {
            let valid = sha256.len() == 64 && sha256.chars().all(|c| c.is_ascii_hexdigit());
            if !valid {
                return Err(schema_violation(format!(
                    "binary target {platform} sha256 must be 64 hex characters"
                )));
            }
        }
        Ok(())
    }
}

/// The ACP registry binary-distribution key for the running host, or `None`
/// when Cadencr runs somewhere the registry has no name for.
pub fn current_binary_target() -> Option<&'static str> {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "linux" => "linux",
        "windows" => "windows",
        _ => return None,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        _ => return None,
    };
    let host = format!("{os}-{arch}");
    ACP_BINARY_TARGETS
        .iter()
        .copied()
        .find(|target| *target == host)
}

fn schema_violation(message: impl Into<String>) -> DescriptorError {
    DescriptorError::new(RejectionCode::DescriptorSchemaViolation, message)
}

/// Match a preserved registry field against [`PROTOCOL_OWNED_FIELDS`] ignoring
/// case and separators, so no spelling of the same idea slips through.
fn is_protocol_owned_field(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect();
    PROTOCOL_OWNED_FIELDS.contains(&normalized.as_str())
}

fn is_registry_id(id: &str) -> bool {
    let mut chars = id.chars();
    chars.next().is_some_and(|first| first.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// The registry pattern is `^[0-9]+\.[0-9]+\.[0-9]+` — anchored at the start
/// only, so pre-release and build suffixes are allowed to follow.
fn is_semver_prefixed(version: &str) -> bool {
    let mut segments = version.splitn(3, '.');
    let (Some(major), Some(minor), Some(rest)) =
        (segments.next(), segments.next(), segments.next())
    else {
        return false;
    };
    let patch: String = rest.chars().take_while(char::is_ascii_digit).collect();
    !major.is_empty()
        && !minor.is_empty()
        && !patch.is_empty()
        && major.chars().all(|c| c.is_ascii_digit())
        && minor.chars().all(|c| c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::{
        current_binary_target, AcpAgentEntry, ProviderDescriptor, RejectionCode, ACP_BINARY_TARGETS,
    };
    use serde_json::json;

    fn descriptor(value: serde_json::Value) -> ProviderDescriptor {
        serde_json::from_value(value).expect("descriptor should deserialize")
    }

    fn valid_agent() -> serde_json::Value {
        json!({
            "id": "acme-agent",
            "name": "Acme Agent",
            "version": "1.2.3",
            "description": "An ACP agent",
        })
    }

    #[test]
    fn accepts_a_minimal_local_entry() {
        let parsed = descriptor(json!({
            "schema_version": 1,
            "agent": valid_agent(),
            "installation": { "executable": { "command": "/usr/local/bin/acme" } },
        }));
        parsed.validate().expect("minimal entry should validate");
        assert!(parsed.installation.enabled, "enablement defaults to on");
        assert_eq!(
            parsed
                .installation
                .executable
                .expect("executable")
                .args
                .len(),
            0
        );
    }

    #[test]
    fn rejects_unsupported_schema_versions() {
        let error = descriptor(json!({ "schema_version": 99, "agent": valid_agent() }))
            .validate()
            .expect_err("future schema versions must be rejected");
        assert_eq!(error.code, RejectionCode::UnsupportedSchemaVersion);
    }

    #[test]
    fn rejects_ids_outside_the_registry_pattern() {
        for bad in ["Acme", "1acme", "acme_agent", "acme agent", ""] {
            let mut agent = valid_agent();
            agent["id"] = json!(bad);
            let error = descriptor(json!({ "schema_version": 1, "agent": agent }))
                .validate()
                .expect_err("id should be rejected");
            assert_eq!(
                error.code,
                RejectionCode::DescriptorSchemaViolation,
                "{bad}"
            );
        }
    }

    #[test]
    fn requires_name_description_and_semver() {
        for (field, value) in [("name", json!("")), ("description", json!(" "))] {
            let mut agent = valid_agent();
            agent[field] = value;
            let error = descriptor(json!({ "schema_version": 1, "agent": agent }))
                .validate()
                .expect_err("empty field should be rejected");
            assert_eq!(error.code, RejectionCode::DescriptorSchemaViolation);
        }
        for bad in ["1", "1.2", "v1.2.3", "1.2.x"] {
            let mut agent = valid_agent();
            agent["version"] = json!(bad);
            let error = descriptor(json!({ "schema_version": 1, "agent": agent }))
                .validate()
                .expect_err("bad version should be rejected");
            assert_eq!(
                error.code,
                RejectionCode::DescriptorSchemaViolation,
                "{bad}"
            );
        }
        let mut agent = valid_agent();
        agent["version"] = json!("1.2.3-beta.1");
        descriptor(json!({ "schema_version": 1, "agent": agent }))
            .validate()
            .expect("pre-release suffixes are allowed by the registry pattern");
    }

    #[test]
    fn validates_the_distribution_block_when_present() {
        let mut agent = valid_agent();
        agent["distribution"] = json!({});
        let error = descriptor(json!({ "schema_version": 1, "agent": agent.clone() }))
            .validate()
            .expect_err("empty distribution should be rejected");
        assert_eq!(error.code, RejectionCode::DescriptorSchemaViolation);

        agent["distribution"] =
            json!({ "binary": { "plan9-riscv": { "archive": "https://x", "cmd": "x" } } });
        let error = descriptor(json!({ "schema_version": 1, "agent": agent.clone() }))
            .validate()
            .expect_err("unknown platform key should be rejected");
        assert_eq!(error.code, RejectionCode::DescriptorSchemaViolation);

        agent["distribution"] = json!({ "binary": { "linux-x86_64": { "archive": "https://x", "cmd": "x", "sha256": "abc" } } });
        let error = descriptor(json!({ "schema_version": 1, "agent": agent.clone() }))
            .validate()
            .expect_err("short sha256 should be rejected");
        assert_eq!(error.code, RejectionCode::DescriptorSchemaViolation);

        agent["distribution"] = json!({ "npx": { "package": "@acme/agent@1.2.3" } });
        descriptor(json!({ "schema_version": 1, "agent": agent }))
            .validate()
            .expect("npx distribution should validate");
    }

    #[test]
    fn platform_support_falls_back_to_package_distributions() {
        let entry: AcpAgentEntry = serde_json::from_value(json!({
            "id": "acme-agent",
            "name": "Acme Agent",
            "version": "1.0.0",
            "description": "d",
            "distribution": { "npx": { "package": "@acme/agent@1.0.0" } },
        }))
        .unwrap();
        assert!(entry
            .distribution
            .expect("distribution")
            .supports_current_platform());
    }

    #[test]
    fn binary_only_distribution_must_name_this_host() {
        let current = current_binary_target().expect("supported test platform");
        let other = ACP_BINARY_TARGETS
            .iter()
            .find(|target| **target != current)
            .expect("another target");
        let entry: AcpAgentEntry = serde_json::from_value(json!({
            "id": "acme-agent",
            "name": "Acme Agent",
            "version": "1.0.0",
            "description": "d",
            "distribution": { "binary": { (*other): { "archive": "https://x", "cmd": "acme" } } },
        }))
        .unwrap();
        assert!(!entry
            .distribution
            .expect("distribution")
            .supports_current_platform());
    }

    /// A descriptor may not pre-declare what ACP negotiates. Silently ignoring
    /// such a field would let marketplace JSON look authoritative over the
    /// handshake, so the whole descriptor is refused.
    #[test]
    fn rejects_fields_the_acp_handshake_owns() {
        for key in [
            "models",
            "modes",
            "permissions",
            "permission_modes",
            "authMethods",
            "capabilities",
            "default_model",
            "thinking-levels",
            "accessModes",
            "slash_commands",
        ] {
            let mut agent = valid_agent();
            agent[key] = json!(["anything"]);
            let error = descriptor(json!({ "schema_version": 1, "agent": agent }))
                .validate()
                .expect_err("a protocol-owned field must be refused");
            assert_eq!(
                error.code,
                RejectionCode::DescriptorSchemaViolation,
                "{key}"
            );
            assert!(error.message.contains(key), "{key}: {}", error.message);
        }
    }

    /// The host envelope is ours, so a typo there is a mistake to surface — not
    /// a field from a newer registry to preserve.
    #[test]
    fn rejects_unknown_host_envelope_fields() {
        for value in [
            json!({ "schema_version": 1, "agent": valid_agent(), "provider": "acme" }),
            json!({
                "schema_version": 1,
                "agent": valid_agent(),
                "installation": { "enable": true },
            }),
            json!({
                "schema_version": 1,
                "agent": valid_agent(),
                "installation": { "executable": { "command": "/bin/acme", "shell": "zsh" } },
            }),
        ] {
            let error = serde_json::from_value::<ProviderDescriptor>(value)
                .expect_err("unknown host fields must not be ignored");
            assert!(error.to_string().contains("unknown field"), "{error}");
        }
    }

    /// Registry fields this build does not model must survive a round trip, so
    /// an imported entry can be exported again without silent data loss.
    #[test]
    fn unknown_registry_fields_round_trip() {
        let entry: AcpAgentEntry = serde_json::from_value(json!({
            "id": "acme-agent",
            "name": "Acme Agent",
            "version": "1.0.0",
            "description": "d",
            "license": "MIT",
            "futureField": { "nested": [1, 2, 3] },
        }))
        .unwrap();
        assert_eq!(entry.extra.get("futureField").unwrap()["nested"][2], 3);
        let exported = serde_json::to_value(&entry).unwrap();
        assert_eq!(exported["futureField"]["nested"][2], 3);
        assert_eq!(exported["license"], "MIT");
    }
}
