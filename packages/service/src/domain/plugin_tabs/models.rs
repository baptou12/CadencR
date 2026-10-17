//! Host API shapes for custom tabs (`docs/CUSTOM_TABS.md` §4.2).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

pub use cadencr_plugin_core::tab::{
    TabConfigField, TabConfigFieldType, TabConfigScope, TabIssue, TabIssueCode,
};

/// One local custom tab, valid or not.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PluginTabSummary {
    pub id: String,
    /// The manifest name, or the id when `tab.json` could not be parsed.
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    /// The tab trigger text (`tab.label`, else the name).
    pub label: String,
    /// The icon's SVG markup, inlined so the renderer needs no extra request.
    pub icon_svg: Option<String>,
    pub api_version: Option<u32>,
    pub entry: Option<String>,
    /// Whether `entry` exists — `false` until the author first builds.
    pub entry_present: bool,
    pub permissions: Vec<String>,
    pub network: PluginTabNetwork,
    pub configuration: Vec<TabConfigField>,
    /// What consent is recorded against; `None` when the manifest is unreadable.
    pub permissions_hash: Option<String>,
    pub status: PluginTabStatus,
    pub errors: Vec<TabIssue>,
    pub warnings: Vec<TabIssue>,
    /// Absolute path of the tab folder.
    pub dir: String,
    /// The project this tab is authored in, when Cadencr created one.
    pub authoring_project_id: Option<i64>,
    pub enablement: PluginTabEnablement,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
pub struct PluginTabNetwork {
    pub allowed_origins: Vec<String>,
    pub reasoning: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum PluginTabStatus {
    Valid,
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct PluginTabEnablement {
    /// The global switch; `None` when never set (off).
    pub global: Option<bool>,
    /// The requested project's override; `None` when unset or no project was given.
    pub project: Option<bool>,
    /// Switched on, consented at the current hash, and valid.
    pub effective: bool,
    /// No consent, or consent for an older permissions hash.
    pub consent_required: bool,
}

/// `?project_id=` on reads that can show one project's view.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PluginTabProjectQuery {
    pub project_id: Option<i64>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetPluginTabEnablementRequest {
    /// `null` targets the global switch.
    pub project_id: Option<i64>,
    /// `null` clears the switch (a project falls back to global, global to off).
    pub enabled: Option<bool>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PluginTabConsentRequest {
    /// The hash the user was shown; must equal the current one.
    pub permissions_hash: String,
}

/// The settings form: the declared fields and the stored values. Secret values
/// are never returned; a set secret reads `{ "is_set": true }`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PluginTabConfiguration {
    pub fields: Vec<TabConfigField>,
    #[schema(value_type = Object)]
    pub global: BTreeMap<String, serde_json::Value>,
    /// The requested project's values; `None` when no project was given.
    #[schema(value_type = Option<Object>)]
    pub project: Option<BTreeMap<String, serde_json::Value>>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PutPluginTabConfigurationRequest {
    /// Key → new value; `null` removes the stored value. Keys not listed are
    /// left untouched, so a form can omit secrets it did not change.
    #[schema(value_type = Object)]
    pub values: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreatePluginTabRequest {
    /// Human-readable name; the id is slugified from it.
    pub name: String,
    pub description: Option<String>,
}

/// Where a tab is authored. The renderer navigates to the conversation.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PluginTabWorkspace {
    pub plugin_id: String,
    pub project_id: i64,
    pub feature_id: i64,
    /// The tab folder — the project root and the agent's cwd.
    pub dir: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreatePluginTabGrantRequest {
    /// The feature the tab instance is shown in; the grant binds to it and
    /// its project.
    pub feature_id: i64,
}

/// A plugin token for one tab instance. Opaque; send it as
/// `x-cadencr-plugin-token` (HTTP) or the `cadencr-plugin.<token>`
/// subprotocol (`/api/plugin-tabs/ws`). In memory only, never persisted.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PluginTabGrant {
    pub token: String,
    /// RFC 3339; mint a new grant before then.
    pub expires_at: String,
    /// The consented scopes (§6) the token carries.
    pub scopes: Vec<String>,
    pub api_version: u32,
}

/// `POST /api/plugin-tabs/self/net/fetch` (§4.5). The request body is the
/// raw upstream body; outbound headers ride in `x-cadencr-net-headers`.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PluginNetFetchQuery {
    /// Absolute URL whose origin is in the manifest's `network.allowed_origins`.
    pub url: String,
    /// HTTP method, `GET` when omitted.
    pub method: Option<String>,
}
