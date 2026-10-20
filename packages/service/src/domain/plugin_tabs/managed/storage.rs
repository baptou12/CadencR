mod cache;
mod filesystem;
#[cfg(test)]
pub(in crate::domain::plugin_tabs) mod fixtures;
mod retention;
use super::invalid;
use crate::{
    domain::themes::managed::{catalog, models::SignedMixedCatalog, storage as io},
    error::AppError,
};
use cadencr_plugin_core::tab::TabManifest;
use filesystem::check_directory;
pub use filesystem::{secure, write_file};
pub use retention::{lease, RevisionLease};
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
#[cfg(test)]
pub(super) fn read_trusted(
    root: &Path,
    id: &str,
    trust: &crate::domain::agents::providers::installed::managed::trust::ManagedTrustStore,
) -> Result<(Receipt, BTreeMap<String, Vec<u8>>, TabManifest), AppError> {
    let dir = directory(root, id)?.ok_or_else(|| invalid("managed tab is not installed"))?;
    read_trusted_directory(root, id, &dir, trust)
}
pub(super) fn read_trusted_directory(
    root: &Path,
    id: &str,
    dir: &Path,
    trust: &crate::domain::agents::providers::installed::managed::trust::ManagedTrustStore,
) -> Result<(Receipt, BTreeMap<String, Vec<u8>>, TabManifest), AppError> {
    check_directory(root, dir)?;
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
/// The signed package's manifest. Never a native backend: no publisher is verified.
pub fn verify_identity(
    package: &serde_json::Value,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<TabManifest, AppError> {
    let manifest =
        cadencr_registry_core::validate_tab_package_files(package, files).map_err(invalid)?;
    if manifest.backend.is_some() {
        return Err(invalid("a marketplace tab cannot ship a native `backend`"));
    }
    Ok(manifest)
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
    let cell = retention::admit_owner(root, &receipt.id)?;
    let state = cell.lock().map_err(invalid)?;
    secure(root, &owner)?;
    let sha = io::digest(archive);
    let destination = owner.join(&sha);
    if !destination.try_exists().map_err(invalid)? {
        retention::prepare(root, &receipt.id, &state)?;
        let mut builder = tempfile::Builder::new();
        builder.prefix(".stage-");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            builder.permissions(std::fs::Permissions::from_mode(0o700));
        }
        // Do not let TempDir recursively delete an interrupted/modified tree:
        // partial stages stay bounded by retention admission and need review.
        let staging = builder.tempdir_in(&owner).map_err(invalid)?.keep();
        let payload = staging.join(&receipt.id);
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
        write_file(&staging.join("archive.tar.gz"), archive)?;
        crate::shared::atomic_file::write_atomic_private(
            &staging.join("receipt.json"),
            &serde_json::to_string(receipt).map_err(invalid)?,
        )?;
        std::fs::rename(&staging, &destination).map_err(invalid)?;
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
    // Only replace managed JSON, never an unknown file occupying a control path.
    let retained: Receipt = serde_json::from_slice(&io::regular(
        &destination.join("receipt.json"),
        LIMIT + 64 * 1024,
    )?)
    .map_err(invalid)?;
    if retained.id != receipt.id || retained.version != receipt.version {
        return Err(invalid("retained tab receipt identity mismatch"));
    }
    if owner.join("active.json").symlink_metadata().is_ok() {
        validate_pointer(&owner.join("active.json"))?;
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

fn validate_pointer(path: &Path) -> Result<(), AppError> {
    let pointer: String = serde_json::from_slice(&io::regular(path, 1024)?).map_err(invalid)?;
    if pointer.len() != 64
        || !pointer
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(invalid(
            "invalid tab revision pointer; unknown file preserved",
        ));
    }
    Ok(())
}

/// Uninstall only the active pointer and recognized, unleased managed artifacts.
pub fn deactivate(root: &Path, id: &str) -> Result<(), AppError> {
    let cell = retention::owner_state(root, id)?;
    let state = cell.lock().map_err(invalid)?;
    let owned = owner(root, id)?;
    check_directory(root, &owned)?;
    validate_pointer(&owned.join("active.json"))?;
    std::fs::remove_file(owned.join("active.json")).map_err(invalid)?;
    retention::collect(root, id, &state)?;
    retention::remove_empty_owner(root, id, &cell)
}

#[cfg(test)]
pub(super) mod tests {
    use super::fixtures::fixture;
    use super::*;

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
    fn unknown_database_at_control_paths_is_never_removed_or_replaced() {
        let temp = tempfile::tempdir().unwrap();
        let (receipt, archive, files, _) = fixture(temp.path());
        let root = temp.path().join("managed");
        commit(&root, &receipt, &archive, &files).unwrap();
        let pointer = root.join("graph/active.json");
        let proof = directory(&root, "graph")
            .unwrap()
            .unwrap()
            .parent()
            .unwrap()
            .join("receipt.json");
        let database = b"SQLite format 3\0precious";
        std::fs::write(&proof, database).unwrap();
        assert!(commit(&root, &receipt, &archive, &files).is_err());
        assert_eq!(std::fs::read(proof).unwrap(), database);
        std::fs::write(&pointer, database).unwrap();
        assert!(deactivate(&root, "graph").is_err());
        assert_eq!(std::fs::read(pointer).unwrap(), database);
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

    #[test]
    fn a_marketplace_package_cannot_ship_a_native_backend() {
        let temp = tempfile::tempdir().unwrap();
        let (receipt, _, mut files, _) = fixture(temp.path());
        let package = catalog::resolve_kind(&receipt.index, "graph", &receipt.version, "tab")
            .expect("the fixture's package");
        assert!(verify_identity(&package, &files).is_ok());
        let mut manifest: serde_json::Value = serde_json::from_slice(&files["tab.json"]).unwrap();
        manifest["backend"] = serde_json::json!({"command": "node", "reasoning": "r"});
        files.insert("tab.json".into(), serde_json::to_vec(&manifest).unwrap());
        assert!(format!("{:?}", verify_identity(&package, &files)).contains("native `backend`"));
    }
}
