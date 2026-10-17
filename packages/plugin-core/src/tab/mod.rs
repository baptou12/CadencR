//! Custom tabs: local web-UI plugins shown as a feature-page tab.
//!
//! The contract is `docs/CUSTOM_TABS.md`. This module owns §3: the `tab.json`
//! manifest, its validation rules and the permissions hash consent is recorded
//! against. The service and `cadencr plugin validate --kind tab` both call
//! [`inspect_tab_folder`], so the app and the CLI can never disagree about
//! whether a tab is valid.

mod configuration;
mod folder;
mod hash;
mod issues;
mod manifest;
mod network;
mod validate;

/// The `docs/CUSTOM_TABS.md` §3 example manifest, for tests here and in the
/// crates that build on this one (`features = ["test-support"]`).
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;

pub use folder::{inspect_tab_folder, read_tab_manifest, TabFolderReport};
pub use issues::{describe_all, TabFindings, TabIssue, TabIssueCode};
pub use manifest::{
    TabConfigField, TabConfigFieldType, TabConfigScope, TabManifest, TabNetwork, TabSection,
};
pub use validate::{
    is_clean_relative_path, is_valid_tab_id, validate_manifest, MAX_DESCRIPTION_CHARS,
    MAX_LABEL_CHARS, MAX_NAME_CHARS, RESERVED_IDS,
};

pub const MANIFEST_FILE_NAME: &str = "tab.json";
pub const SUPPORTED_SCHEMA_VERSION: u32 = 1;
/// The plugin API version this host speaks. v1 hosts accept exactly `1`.
pub const SUPPORTED_API_VERSION: u32 = 1;
pub const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
pub const MAX_ICON_BYTES: u64 = 32 * 1024;

/// Every scope a tab can request (§6), in documentation order.
pub const SCOPES: [&str; 6] = [
    "features:read",
    "git:read",
    "forge:read",
    "files:read",
    "agent:observe",
    "workspace:read",
];
