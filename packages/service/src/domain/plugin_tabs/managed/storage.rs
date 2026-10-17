mod cache;
mod filesystem;
use super::invalid;
use crate::{
    domain::themes::managed::{catalog, models::SignedMixedCatalog, storage as io},
    error::AppError,
};
use cadencr_plugin_core::tab::TabManifest;
use filesystem::check_directory;
pub use filesystem::{secure, write_file};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

const LIMIT: usize = 32 * 1024 * 1024;
const MAX_ACTIVE_TABS: usize = 128;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    pub index: SignedMixedCatalog,
    pub id: String,
    pub version: String,
}

pub fn root() -> PathBuf {
    crate::domain::settings_store::dir::sibling_dir("plugins").join("managed-tabs")
}
pub fn owner(root: &Path, id: &str) -> Result<PathBuf, AppError> {
    if !cadencr_plugin_core::tab::is_valid_tab_id(id)
        || cadencr_plugin_core::tab::RESERVED_IDS.contains(&id)
    {
        return Err(invalid("invalid managed tab id"));
    }
    Ok(root.join(id))
}
pub fn directory(root: &Path, id: &str) -> Result<Option<PathBuf>, AppError> {
    let owner = owner(root, id)?;
    let pointer = owner.join("active.json");
    if !pointer.try_exists().map_err(invalid)? {
        return Ok(None);
    }
    check_directory(root, &owner)?;
    let revision: String =
        serde_json::from_slice(&io::regular(&pointer, 1024)?).map_err(invalid)?;
    if revision.len() != 64
        || !revision
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(invalid("invalid tab revision pointer"));
    }
    let dir = owner.join(revision).join(id);
    check_directory(root, &dir)?;
    Ok(Some(dir))
}
pub fn ids(root: &Path) -> Result<Vec<String>, AppError> {
    if !root.try_exists().map_err(invalid)? {
        return Ok(Vec::new());
    }
    check_directory(root, root)?;
    let mut ids = Vec::new();
    for entry in std::fs::read_dir(root).map_err(invalid)? {
        let id = entry
            .map_err(invalid)?
            .file_name()
            .to_string_lossy()
            .to_string();
        if id.starts_with('.') {
            continue;
        }
        match owner(root, &id)?.join("active.json").symlink_metadata() {
            Ok(_) => ids.push(id),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(invalid(error)),
        }
    }
    Ok(ids)
}
pub fn read(root: &Path, id: &str) -> Result<TabManifest, AppError> {
    cache::read(root, id)
}
pub(super) fn read_trusted(
    root: &Path,
    id: &str,
    trust: &crate::domain::agents::providers::installed::managed::trust::ManagedTrustStore,
) -> Result<(Receipt, BTreeMap<String, Vec<u8>>, TabManifest), AppError> {
    let dir = directory(root, id)?.ok_or_else(|| invalid("managed tab is not installed"))?;
    let revision = dir.parent().ok_or_else(|| invalid("revision missing"))?;
    let receipt: Receipt = serde_json::from_slice(&io::regular(
        &revision.join("receipt.json"),
        LIMIT + 64 * 1024,
    )?)
    .map_err(invalid)?;
    if receipt.id != id {
        return Err(invalid("tab receipt identity mismatch"));
    }
    catalog::verify(&receipt.index, trust, true)?;
    let package = catalog::resolve_kind(&receipt.index, id, &receipt.version, "tab")?;
    let archive = io::regular(&revision.join("archive.tar.gz"), LIMIT)?;
    if package["tab"]["distribution"]["sha256"].as_str() != Some(io::digest(&archive).as_str()) {
        return Err(invalid("tab archive checksum mismatch"));
    }
    let files = cadencr_registry_core::read_tab_archive_bytes(&archive).map_err(invalid)?;
    let manifest = verify_identity(&package, &files)?;
    for (name, bytes) in &files {
        if io::regular(&dir.join(name), LIMIT)? != *bytes {
            return Err(invalid("installed tab payload changed"));
        }
    }
    Ok((receipt, files, manifest))
}
pub fn verify_identity(
    package: &serde_json::Value,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<TabManifest, AppError> {
    cadencr_registry_core::validate_tab_package_files(package, files).map_err(invalid)
}

pub fn commit(
    root: &Path,
    receipt: &Receipt,
    archive: &[u8],
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<(), AppError> {
    if archive.len() > LIMIT {
        return Err(invalid("tab archive exceeds 32 MiB"));
    }
    let owner = owner(root, &receipt.id)?;
    let active = ids(root)?;
    if !active.contains(&receipt.id) && active.len() >= MAX_ACTIVE_TABS {
        return Err(invalid(
            "at most 128 marketplace tabs can be installed at once",
        ));
    }
    secure(root, &owner)?;
    let sha = io::digest(archive);
    let destination = owner.join(&sha);
    if !destination.try_exists().map_err(invalid)? {
        if std::fs::read_dir(&owner).map_err(invalid)?.take(17).count() >= 17 {
            return Err(invalid(
                "tab revision storage is full; review retained revisions before retrying",
            ));
        }
        let mut builder = tempfile::Builder::new();
        builder.prefix(".stage-");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            builder.permissions(std::fs::Permissions::from_mode(0o700));
        }
        let staging = builder.tempdir_in(&owner).map_err(invalid)?;
        let payload = staging.path().join(&receipt.id);
        secure(root, &payload)?;
        for (name, bytes) in files {
            let path = payload.join(name);
            secure(
                root,
                path.parent()
                    .ok_or_else(|| invalid("asset parent missing"))?,
            )?;
            write_file(&path, bytes)?;
        }
        write_file(&staging.path().join("archive.tar.gz"), archive)?;
        crate::shared::atomic_file::write_atomic_private(
            &staging.path().join("receipt.json"),
            &serde_json::to_string(receipt).map_err(invalid)?,
        )?;
        std::fs::rename(staging.path(), &destination).map_err(invalid)?;
    }
    check_directory(root, &destination.join(&receipt.id))?;
    if io::regular(&destination.join("archive.tar.gz"), LIMIT)? != archive {
        return Err(invalid(
            "retained tab archive differs from requested revision",
        ));
    }
    for (name, bytes) in files {
        if io::regular(&destination.join(&receipt.id).join(name), LIMIT)? != *bytes {
            return Err(invalid("retained tab payload changed"));
        }
    }
    // Store the newly authenticated catalog proof even when reusing identical bytes.
    crate::shared::atomic_file::write_atomic_private(
        &destination.join("receipt.json"),
        &serde_json::to_string(receipt).map_err(invalid)?,
    )?;
    let previous = owner.join("active.json");
    crate::shared::atomic_file::write_atomic_private(
        &previous,
        &serde_json::to_string(&sha).map_err(invalid)?,
    )
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::domain::agents::providers::installed::managed::trust::{
        ManagedTrustStore, TrustedIndexKey,
    };
    use base64::Engine as _;
    use ed25519_dalek::{Signer as _, SigningKey};

    pub(in crate::domain::plugin_tabs::managed) fn fixture(
        root: &Path,
    ) -> (
        Receipt,
        Vec<u8>,
        BTreeMap<String, Vec<u8>>,
        ManagedTrustStore,
    ) {
        let stage = root.join("input");
        std::fs::create_dir_all(stage.join("dist")).unwrap();
        std::fs::write(stage.join("tab.json"), r#"{"schema_version":1,"kind":"tab","id":"graph","name":"Graph","version":"1.0.0","api_version":1,"entry":"dist/index.html","permissions":["git:read"]}"#).unwrap();
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
        let payload = serde_json::json!({"schema_version":2,"generated_at":(now-chrono::Duration::minutes(1)).to_rfc3339_opts(chrono::SecondsFormat::Secs,true),"expires_at":(now+chrono::Duration::hours(1)).to_rfc3339_opts(chrono::SecondsFormat::Secs,true),"packages":[{"kind":"tab","package":{"tab":{"id":"graph","name":"Graph","description":"A graph","version":"1.0.0","api_version":1,"license":"MIT","repository":"https://github.com/acme/tabs","distribution":{"archive":"https://github.com/acme/tabs/releases/download/v1.0.0/tab.tar.gz","sha256":packed.sha256}},"host":{"publisher":"acme","compatibility":{"min_app_version":"0.1.0"}}}}]});
        let key = SigningKey::from_bytes(&[37; 32]);
        let bytes = cadencr_registry_core::canonical_json_bytes(&payload);
        let index = serde_json::from_value(serde_json::json!({"signed":payload,"signature":{"algorithm":"ed25519","key_id":"tab-test","value":base64::engine::general_purpose::STANDARD.encode(key.sign(&bytes).to_bytes())}})).unwrap();
        let trust = ManagedTrustStore::new([TrustedIndexKey::new(
            "tab-test",
            key.verifying_key().to_bytes(),
        )
        .unwrap()]);
        let archive = std::fs::read(output).unwrap();
        let files = cadencr_registry_core::read_tab_archive_bytes(&archive).unwrap();
        (
            Receipt {
                index,
                id: "graph".into(),
                version: "1.0.0".into(),
            },
            archive,
            files,
            trust,
        )
    }

    #[test]
    fn signed_revisions_preserve_payload_and_reject_forged_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let (receipt, archive, files, trust) = fixture(temp.path());
        let root = temp.path().join("managed");
        commit(&root, &receipt, &archive, &files).unwrap();
        let (_, found, manifest) = read_trusted(&root, "graph", &trust).unwrap();
        assert_eq!(found, files);
        assert_eq!(manifest.permissions, ["git:read"]);
        let dir = directory(&root, "graph").unwrap().unwrap();
        crate::shared::atomic_file::write_atomic_private(&dir.join("dist/index.html"), "tampered")
            .unwrap();
        assert!(read_trusted(&root, "graph", &trust).is_err());
        assert!(
            commit(&root, &receipt, &archive, &files).is_err(),
            "retained corrupted revision cannot be activated"
        );
        crate::shared::atomic_file::write_atomic_private(
            &dir.join("dist/index.html"),
            "<html>Graph</html>",
        )
        .unwrap();
        let mut forged = receipt;
        forged.index.signed.packages[0]["package"]["tab"]["name"] = serde_json::json!("Impostor");
        crate::shared::atomic_file::write_atomic_private(
            &dir.parent().unwrap().join("receipt.json"),
            &serde_json::to_string(&forged).unwrap(),
        )
        .unwrap();
        assert!(read_trusted(&root, "graph", &trust).is_err());
    }

    #[test]
    fn runtime_identity_and_paths_cannot_be_rebound() {
        let temp = tempfile::tempdir().unwrap();
        let (receipt, archive, files, _) = fixture(temp.path());
        let mut package = receipt.index.signed.packages[0]["package"].clone();
        package["tab"]["version"] = serde_json::json!("2.0.0");
        assert!(verify_identity(&package, &files).is_err());
        let root = temp.path().join("managed");
        commit(&root, &receipt, &archive, &files).unwrap();
        for id in ["../graph", "self", "grants", "A"] {
            assert!(directory(&root, id).is_err());
        }
        crate::shared::atomic_file::write_atomic_private(
            &root.join("graph/active.json"),
            r#""../escape""#,
        )
        .unwrap();
        assert!(directory(&root, "graph").is_err());
    }

    #[test]
    fn tab_archive_storage_uses_the_tab_budget_instead_of_the_theme_budget() {
        let temp = tempfile::tempdir().unwrap();
        let (receipt, _, files, _) = fixture(temp.path());
        let root = temp.path().join("managed");
        let archive = vec![0; 20 * 1024 * 1024 + 1];
        commit(&root, &receipt, &archive, &files).unwrap();
        let dir = directory(&root, "graph").unwrap().unwrap();
        assert_eq!(
            io::regular(&dir.parent().unwrap().join("archive.tar.gz"), LIMIT).unwrap(),
            archive
        );
        let too_large = vec![0; LIMIT + 1];
        assert!(commit(&root, &receipt, &too_large, &files).is_err());
        assert_eq!(directory(&root, "graph").unwrap().unwrap(), dir);
    }

    #[test]
    fn full_revision_history_still_allows_reusing_authenticated_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let (receipt, archive, files, trust) = fixture(temp.path());
        let root = temp.path().join("managed");
        commit(&root, &receipt, &archive, &files).unwrap();
        let owner = owner(&root, "graph").unwrap();
        for revision in 0..15 {
            secure(&root, &owner.join(format!("{revision:064x}"))).unwrap();
        }
        assert_eq!(std::fs::read_dir(owner).unwrap().count(), 17);
        commit(&root, &receipt, &archive, &files).unwrap();
        read_trusted(&root, "graph", &trust).unwrap();
        assert!(commit(&root, &receipt, b"another revision", &files).is_err());
        read_trusted(&root, "graph", &trust).unwrap();
    }

    #[test]
    fn capacity_counts_active_tabs_and_retained_history_remains_reusable() {
        let temp = tempfile::tempdir().unwrap();
        let (receipt, archive, files, trust) = fixture(temp.path());
        let root = temp.path().join("managed");
        for number in 0..MAX_ACTIVE_TABS {
            let owner = owner(&root, &format!("retained-{number}")).unwrap();
            secure(&root, &owner).unwrap();
            write_file(&owner.join("active.json"), br#""unreadable""#).unwrap();
        }
        assert!(commit(&root, &receipt, &archive, &files).is_err());
        assert!(!root.join("graph").exists());
        assert_eq!(ids(&root).unwrap().len(), MAX_ACTIVE_TABS);
        for number in 0..MAX_ACTIVE_TABS {
            std::fs::remove_file(root.join(format!("retained-{number}/active.json"))).unwrap();
        }
        assert!(ids(&root).unwrap().is_empty());
        commit(&root, &receipt, &archive, &files).unwrap();
        assert_eq!(ids(&root).unwrap(), ["graph"]);
        read_trusted(&root, "graph", &trust).unwrap();
    }
}

pub fn verify_asset(root: &Path, id: &str, file: &Path) -> Result<(), AppError> {
    cache::verify_asset(root, id, file)
}
