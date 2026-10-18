//! Signed archive fixtures shared by the managed tab unit tests.
use super::*;
use crate::domain::agents::providers::installed::managed::trust::{
    ManagedTrustStore, TrustedIndexKey,
};
use base64::Engine as _;
use ed25519_dalek::{Signer as _, SigningKey};

pub(in crate::domain::plugin_tabs) fn fixture(
    root: &Path,
) -> (
    Receipt,
    Vec<u8>,
    BTreeMap<String, Vec<u8>>,
    ManagedTrustStore,
) {
    fixture_revision(root, 0)
}

pub(in crate::domain::plugin_tabs) fn fixture_revision(
    root: &Path,
    revision: usize,
) -> (
    Receipt,
    Vec<u8>,
    BTreeMap<String, Vec<u8>>,
    ManagedTrustStore,
) {
    fixture_for().root(root).revision(revision).call()
}

#[bon::builder]
pub(in crate::domain::plugin_tabs::managed) fn fixture_for(
    root: &Path,
    #[builder(default = "graph")] id: &str,
    #[builder(default)] revision: usize,
    maximum: Option<&str>,
) -> (
    Receipt,
    Vec<u8>,
    BTreeMap<String, Vec<u8>>,
    ManagedTrustStore,
) {
    let version = format!("1.0.{revision}");
    let stage = root.join("input");
    std::fs::create_dir_all(stage.join("dist")).unwrap();
    std::fs::write(stage.join("tab.json"), serde_json::to_vec(&serde_json::json!({"schema_version":1,"kind":"tab","id":id,"name":"Graph","version":version,"api_version":1,"entry":"dist/index.html","permissions":["git:read"]})).unwrap()).unwrap();
    std::fs::write(stage.join("dist/index.html"), "<html>Graph</html>").unwrap();
    let output = root.join("tab.tar.gz");
    let packed = cadencr_registry_core::pack_tab(
        cadencr_registry_core::PackTabRequest::builder()
            .directory(&stage)
            .output(&output)
            .build(),
    )
    .unwrap();
    let now = chrono::Utc::now();
    let mut payload = serde_json::json!({"schema_version":2,"generated_at":(now-chrono::Duration::minutes(1)).to_rfc3339_opts(chrono::SecondsFormat::Secs,true),"expires_at":(now+chrono::Duration::hours(1)).to_rfc3339_opts(chrono::SecondsFormat::Secs,true),"packages":[{"kind":"tab","package":{"tab":{"id":id,"name":"Graph","description":"A graph","version":version,"api_version":1,"license":"MIT","repository":"https://github.com/acme/tabs","distribution":{"archive":"https://github.com/acme/tabs/releases/download/v1.0.0/tab.tar.gz","sha256":packed.sha256}},"host":{"publisher":"acme","compatibility":{"min_app_version":"0.1.0"}}}}]});
    if let Some(maximum) = maximum {
        payload["packages"][0]["package"]["host"]["compatibility"]["max_app_version"] =
            serde_json::json!(maximum);
    }
    let key = SigningKey::from_bytes(&[37; 32]);
    let bytes = cadencr_registry_core::canonical_json_bytes(&payload);
    let index = serde_json::from_value(serde_json::json!({"signed":payload,"signature":{"algorithm":"ed25519","key_id":"tab-test","value":base64::engine::general_purpose::STANDARD.encode(key.sign(&bytes).to_bytes())}})).unwrap();
    let trust =
        ManagedTrustStore::new([
            TrustedIndexKey::new("tab-test", key.verifying_key().to_bytes()).unwrap(),
        ]);
    let archive = std::fs::read(output).unwrap();
    let files = cadencr_registry_core::read_tab_archive_bytes(&archive).unwrap();
    (
        Receipt {
            index,
            id: id.into(),
            version,
        },
        archive,
        files,
        trust,
    )
}
