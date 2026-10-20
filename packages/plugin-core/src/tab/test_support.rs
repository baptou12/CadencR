use serde_json::{json, Value};

use super::issues::TabIssue;
use super::manifest::TabManifest;

/// The `docs/CUSTOM_TABS.md` §3 example with `overrides` merged over its top level
/// (a `null` override removes the key).
pub fn manifest_json(overrides: Value) -> Value {
    manifest_json_for("changed-files-graph", overrides)
}

/// [`manifest_json`] for tab `id`.
pub fn manifest_json_for(id: &str, overrides: Value) -> Value {
    let mut base = json!({
        "schema_version": 1,
        "kind": "tab",
        "id": id,
        "name": "Changed files graph",
        "version": "0.1.0",
        "description": "Graph of the files this feature changed.",
        "icon": "icon.svg",
        "api_version": 1,
        "entry": "dist/index.html",
        "tab": { "label": "Graph" },
        "permissions": ["features:read", "git:read"],
        "network": {
            "allowed_origins": ["https://gitlab.example.com"],
            "reasoning": "Reads merge-request pipelines from the team GitLab."
        },
        "configuration": [
            { "key": "gitlab_url", "type": "string", "label": "GitLab URL", "scope": "global" },
            { "key": "gitlab_token", "type": "secret", "label": "Access token", "scope": "global" },
            { "key": "group", "type": "select", "label": "Grouping", "scope": "project",
              "options": ["directory", "extension"], "default": "directory" }
        ]
    });
    let object = base.as_object_mut().unwrap();
    for (key, value) in overrides.as_object().unwrap() {
        if value.is_null() {
            object.remove(key);
        } else {
            object.insert(key.clone(), value.clone());
        }
    }
    base
}

pub fn manifest(overrides: Value) -> TabManifest {
    serde_json::from_value(manifest_json(overrides)).unwrap()
}

pub fn codes(issues: &[TabIssue]) -> Vec<&'static str> {
    issues.iter().map(|issue| issue.code.as_str()).collect()
}
