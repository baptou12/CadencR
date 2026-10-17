//! The `tab.json` document, exactly as an author writes it.
//!
//! Every struct is closed (`deny_unknown_fields`): the format is unpublished,
//! so a key Cadencr does not know is a typo or a feature that does not exist,
//! and either way the author should hear about it rather than ship it.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A custom tab's manifest (`<plugins>/tabs/<id>/tab.json`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TabManifest {
    pub schema_version: u32,
    /// Always `"tab"`; kept so one folder walker can tell plugin kinds apart.
    pub kind: String,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Relative path of an SVG icon inside the plugin folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub api_version: u32,
    /// Relative path of the HTML page Cadencr loads, e.g. `dist/index.html`.
    pub entry: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab: Option<TabSection>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub network: Option<TabNetwork>,
    #[serde(default)]
    pub configuration: Vec<TabConfigField>,
}

impl TabManifest {
    /// The tab trigger's text: `tab.label`, or the plugin name when unset.
    pub fn label(&self) -> &str {
        self.tab
            .as_ref()
            .and_then(|tab| tab.label.as_deref())
            .unwrap_or(&self.name)
    }

    /// Declared egress origins; empty when the manifest has no `network`.
    pub fn allowed_origins(&self) -> &[String] {
        self.network
            .as_ref()
            .map(|network| network.allowed_origins.as_slice())
            .unwrap_or_default()
    }
}

/// Presentation of the tab trigger.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TabSection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Origins the plugin may reach through the host's egress relay.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TabNetwork {
    #[serde(default)]
    pub allowed_origins: Vec<String>,
    /// Shown to the user at consent time; required when origins are declared.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

/// One settings-form field the plugin reads through `config.get`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TabConfigField {
    pub key: String,
    #[serde(rename = "type")]
    pub field_type: TabConfigFieldType,
    pub label: String,
    pub scope: TabConfigScope,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub default: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TabConfigFieldType {
    String,
    Number,
    Boolean,
    Select,
    /// Write-only from the host's point of view: stored, substituted into
    /// relayed requests, never returned to a client or the guest.
    Secret,
}

/// Where a configuration value is stored: once for every project, or per project.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TabConfigScope {
    Global,
    Project,
}

impl TabConfigField {
    /// Whether `value` is an acceptable stored value for this field.
    pub fn accepts(&self, value: &serde_json::Value) -> bool {
        match self.field_type {
            TabConfigFieldType::String | TabConfigFieldType::Secret => value.is_string(),
            TabConfigFieldType::Number => value.is_number(),
            TabConfigFieldType::Boolean => value.is_boolean(),
            TabConfigFieldType::Select => value
                .as_str()
                .is_some_and(|choice| self.options.iter().any(|option| option == choice)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn label_falls_back_to_the_name() {
        let mut manifest: TabManifest = serde_json::from_value(json!({
            "schema_version": 1, "kind": "tab", "id": "a", "name": "Graph",
            "version": "0.1.0", "api_version": 1, "entry": "dist/index.html"
        }))
        .unwrap();
        assert_eq!(manifest.label(), "Graph");
        assert!(manifest.allowed_origins().is_empty());
        manifest.tab = Some(TabSection {
            label: Some("G".into()),
        });
        assert_eq!(manifest.label(), "G");
    }

    #[test]
    fn unknown_keys_are_rejected_at_every_level() {
        let base = json!({
            "schema_version": 1, "kind": "tab", "id": "a", "name": "A",
            "version": "0.1.0", "api_version": 1, "entry": "dist/index.html"
        });
        let mut top = base.clone();
        top["script"] = json!("evil.js");
        assert!(serde_json::from_value::<TabManifest>(top).is_err());
        let mut nested = base.clone();
        nested["tab"] = json!({"label": "A", "color": "red"});
        assert!(serde_json::from_value::<TabManifest>(nested).is_err());
        let mut field = base;
        field["configuration"] = json!([{
            "key": "k", "type": "string", "label": "K", "scope": "global", "hint": "x"
        }]);
        assert!(serde_json::from_value::<TabManifest>(field).is_err());
    }

    #[test]
    fn fields_accept_only_their_type() {
        let field = |field_type, options: &[&str]| TabConfigField {
            key: "k".into(),
            field_type,
            label: "K".into(),
            scope: TabConfigScope::Global,
            options: options.iter().map(|option| option.to_string()).collect(),
            default: None,
        };
        assert!(field(TabConfigFieldType::String, &[]).accepts(&json!("x")));
        assert!(!field(TabConfigFieldType::String, &[]).accepts(&json!(1)));
        assert!(field(TabConfigFieldType::Number, &[]).accepts(&json!(1.5)));
        assert!(field(TabConfigFieldType::Boolean, &[]).accepts(&json!(false)));
        assert!(field(TabConfigFieldType::Secret, &[]).accepts(&json!("t")));
        let select = field(TabConfigFieldType::Select, &["a", "b"]);
        assert!(select.accepts(&json!("a")));
        assert!(!select.accepts(&json!("c")));
    }
}
