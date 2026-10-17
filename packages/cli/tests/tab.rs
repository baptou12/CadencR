use std::path::Path;
use std::process::{Command, Output};

use serde_json::{json, Value};

fn manifest(id: &str) -> Value {
    json!({
        "schema_version": 1,
        "kind": "tab",
        "id": id,
        "name": "Changed files graph",
        "version": "0.1.0",
        "icon": "icon.svg",
        "api_version": 1,
        "entry": "dist/index.html",
        "tab": { "label": "Graph" },
        "permissions": ["features:read", "git:read"],
        "network": {
            "allowed_origins": ["http://localhost:5173"],
            "reasoning": "Local dev server."
        }
    })
}

fn validate(folder: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_cadencr"))
        .args(["--json", "plugin", "validate"])
        .arg(folder)
        .args(["--kind", "tab"])
        .output()
        .unwrap()
}

#[test]
fn actual_cli_validates_custom_tab_folders() {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("changed-files-graph");
    std::fs::create_dir(&folder).unwrap();
    let path = folder.join("tab.json");
    std::fs::write(
        &path,
        serde_json::to_vec(&manifest("changed-files-graph")).unwrap(),
    )
    .unwrap();
    std::fs::write(folder.join("icon.svg"), "<svg viewBox=\"0 0 24 24\"/>").unwrap();

    let valid = validate(&folder);
    assert!(
        valid.status.success(),
        "{}",
        String::from_utf8_lossy(&valid.stderr)
    );
    let report: Value = serde_json::from_slice(&valid.stdout).unwrap();
    let message = report["message"].as_str().unwrap();
    assert!(
        message.contains("valid custom tab: changed-files-graph"),
        "{message}"
    );
    assert!(message.contains("not built yet"), "{message}");
    assert!(message.contains("ORIGIN_INSECURE_LOCALHOST"), "{message}");

    std::fs::write(&path, serde_json::to_vec(&manifest("other-id")).unwrap()).unwrap();
    let mismatch = validate(&folder);
    assert_eq!(mismatch.status.code(), Some(1));
    let diagnostic: Value = serde_json::from_slice(&mismatch.stderr).unwrap();
    assert_eq!(diagnostic["code"], "TAB_VALIDATION_FAILED");
    assert!(diagnostic["message"]
        .as_str()
        .unwrap()
        .contains("ID_MISMATCH"));

    let mut unknown = manifest("changed-files-graph");
    unknown["script"] = json!("evil.js");
    std::fs::write(&path, serde_json::to_vec(&unknown).unwrap()).unwrap();
    assert_eq!(validate(&folder).status.code(), Some(1));

    let with_descriptor = Command::new(env!("CARGO_BIN_EXE_cadencr"))
        .args(["plugin", "validate"])
        .arg(&folder)
        .args(["--kind", "tab", "--descriptor"])
        .arg(&path)
        .output()
        .unwrap();
    assert_eq!(with_descriptor.status.code(), Some(1));
}
