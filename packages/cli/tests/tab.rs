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
    assert!(message.contains("access: page only"), "{message}");

    let mut runner = manifest("changed-files-graph");
    runner["commands"] = json!([{ "program": "git", "reasoning": "history" }]);
    std::fs::write(&path, serde_json::to_vec(&runner).unwrap()).unwrap();
    let message = serde_json::from_slice::<Value>(&validate(&folder).stdout).unwrap()["message"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(message.contains("access: runs commands (git)"), "{message}");
    runner["commands"] = json!([{ "program": "bash", "reasoning": "anything" }]);
    std::fs::write(&path, serde_json::to_vec(&runner).unwrap()).unwrap();
    let refused = validate(&folder);
    assert_eq!(refused.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&refused.stderr).contains("COMMAND_NOT_ALLOWED"));
    runner["commands"] = json!([]);
    runner["backend"] = json!({ "command": "node", "args": ["server.mjs"], "reasoning": "ports" });
    std::fs::write(&path, serde_json::to_vec(&runner).unwrap()).unwrap();
    let message = serde_json::from_slice::<Value>(&validate(&folder).stdout).unwrap()["message"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        message.contains("native backend `node server.mjs`, which runs with the user's rights"),
        "{message}"
    );

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

#[test]
fn actual_cli_packs_the_compiled_custom_tab_without_overwriting() {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("graph");
    std::fs::create_dir_all(folder.join("dist")).unwrap();
    let mut document = manifest("graph");
    document.as_object_mut().unwrap().remove("icon");
    std::fs::write(folder.join("tab.json"), document.to_string()).unwrap();
    std::fs::write(folder.join("dist/index.html"), "<html>Graph</html>").unwrap();
    let archive = root.path().join("tab.tar.gz");
    let run = || {
        Command::new(env!("CARGO_BIN_EXE_cadencr"))
            .args(["--json", "registry", "pack-tab", "--directory"])
            .arg(&folder)
            .arg("--output")
            .arg(&archive)
            .output()
            .unwrap()
    };
    let output = run();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(receipt["kind"], "tab");
    assert_eq!(receipt["sha256"].as_str().unwrap().len(), 64);
    assert!(!run().status.success());
}

#[test]
fn release_packaging_binds_strict_metadata_to_the_compiled_tab() {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("graph");
    std::fs::create_dir_all(folder.join("dist")).unwrap();
    let mut document = manifest("graph");
    document.as_object_mut().unwrap().remove("icon");
    std::fs::write(folder.join("tab.json"), document.to_string()).unwrap();
    std::fs::write(folder.join("dist/index.html"), "<html>Graph</html>").unwrap();
    let package = json!({"kind":"tab","package":{
        "tab":{"id":"graph","name":document["name"],"description":"Explore changes",
            "version":"0.1.0","repository":"https://github.com/acme/tabs","license":"MIT",
            "api_version":1,"distribution":{
                "archive":"https://github.com/acme/tabs/releases/download/v0.1.0/tab.tar.gz",
                "sha256":"0".repeat(64)}},
        "host":{"publisher":"acme","compatibility":{"min_app_version":"1.0.0"}}
    }});
    let metadata = root.path().join("package.json");
    let run = |output: &Path| {
        Command::new(env!("CARGO_BIN_EXE_cadencr"))
            .args(["--json", "registry", "pack-tab", "--directory"])
            .arg(&folder)
            .arg("--package")
            .arg(&metadata)
            .arg("--output")
            .arg(output)
            .output()
            .unwrap()
    };
    for field in ["id", "name", "version", "api_version"] {
        let mut changed = package.clone();
        changed["package"]["tab"][field] = match field {
            "api_version" => json!(2),
            "version" => json!("0.2.0"),
            _ => json!("different"),
        };
        std::fs::write(&metadata, changed.to_string()).unwrap();
        let output = root.path().join(format!("wrong-{field}.tar.gz"));
        let rejected = run(&output);
        assert_eq!(rejected.status.code(), Some(1), "{field}");
        let error: Value = serde_json::from_slice(&rejected.stderr).unwrap();
        assert_eq!(error["code"], "TAB_PACKAGING_FAILED");
        assert!(!output.exists(), "invalid {field} wrote an archive");
    }
    for invalid in [
        json!({"kind":"provider","package":package.clone()}),
        json!({"kind":"tab","package":package["package"],"extra":true}),
    ] {
        std::fs::write(&metadata, invalid.to_string()).unwrap();
        let output = root.path().join("invalid.tar.gz");
        assert_eq!(run(&output).status.code(), Some(1));
        assert!(!output.exists());
    }
    // Duplicate JSON fields are not silently reinterpreted at this boundary.
    std::fs::write(&metadata, "{\"kind\":\"provider\",\"kind\":\"tab\"}").unwrap();
    assert_eq!(
        run(&root.path().join("duplicate.tar.gz")).status.code(),
        Some(1)
    );
    std::fs::write(&metadata, package.to_string()).unwrap();
    let first = root.path().join("first.tar.gz");
    let second = root.path().join("second.tar.gz");
    let accepted = run(&first);
    assert!(
        accepted.status.success(),
        "{}",
        String::from_utf8_lossy(&accepted.stderr)
    );
    assert!(run(&second).status.success());
    assert_eq!(
        std::fs::read(&first).unwrap(),
        std::fs::read(&second).unwrap()
    );
    assert_eq!(run(&first).status.code(), Some(1));
}
