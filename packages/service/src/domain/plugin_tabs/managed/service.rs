use super::{invalid, storage, InstallManagedTabRequest, ManagedTabInventoryEntry};
use crate::domain::agents::providers::installed::managed::trust::{
    pinned_index_trust_store, ManagedTrustStore,
};
use crate::{
    domain::themes::managed::{catalog, storage as io},
    error::AppError,
};
use std::path::PathBuf;

static MUTATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub async fn inventory() -> Result<Vec<ManagedTabInventoryEntry>, AppError> {
    let root = storage::root();
    tokio::task::spawn_blocking(move || {
        let mut entries = Vec::new();
        for id in storage::ids(&root)? {
            let entry = match storage::read(&root, &id) {
                Ok(manifest) => ManagedTabInventoryEntry {
                    id,
                    name: manifest.name,
                    version: manifest.version,
                    error: None,
                },
                Err(error) => ManagedTabInventoryEntry {
                    name: id.clone(),
                    id,
                    version: String::new(),
                    error: Some(error.to_string()),
                },
            };
            entries.push(entry);
        }
        Ok(entries)
    })
    .await
    .map_err(invalid)?
}

pub async fn install(
    body: InstallManagedTabRequest,
    update: bool,
) -> Result<ManagedTabInventoryEntry, AppError> {
    let root = storage::root();
    let catalog_root = io::root();
    storage::owner(&root, &body.tab_id)?;
    let local = super::super::paths::tabs_dir().join(&body.tab_id);
    let trust = pinned_index_trust_store();
    let index = body.index.clone();
    let id = body.tab_id.clone();
    let version = body.version.clone();
    let package = tokio::task::spawn_blocking(move || {
        catalog::verify(&index, &trust, false)?;
        catalog::resolve_kind(&index, &id, &version, "tab")
    })
    .await
    .map_err(invalid)??;
    let distribution = &package["tab"]["distribution"];
    let bytes = catalog::download_archive(
        distribution["archive"]
            .as_str()
            .ok_or_else(|| invalid("tab archive missing"))?,
        distribution.get("repository"),
        32 * 1024 * 1024,
    )
    .await?;
    let _guard = MUTATION.lock().await;
    let commit_trust = pinned_index_trust_store();
    tokio::task::spawn_blocking(move || {
        io::with_root(catalog_root, || {
            install_bytes()
                .root(root)
                .local(local)
                .body(body)
                .trust(&commit_trust)
                .bytes(bytes)
                .update(update)
                .call()
        })
    })
    .await
    .map_err(invalid)?
}

#[bon::builder]
fn install_bytes(
    root: PathBuf,
    local: PathBuf,
    body: InstallManagedTabRequest,
    trust: &ManagedTrustStore,
    bytes: Vec<u8>,
    update: bool,
) -> Result<ManagedTabInventoryEntry, AppError> {
    match local.symlink_metadata() {
        Ok(_) => {
            return Err(invalid(
                "an editable local tab already owns this id; its files were preserved",
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(invalid(error)),
    }
    let existing = storage::directory(&root, &body.tab_id)?;
    if existing.is_some() != update {
        return Err(invalid(
            "tab installation state changed; reload before retrying",
        ));
    }
    catalog::verify(&body.index, trust, false)?;
    catalog::ingest_trusted(&body.index, trust)?;
    let package = catalog::resolve_kind(&body.index, &body.tab_id, &body.version, "tab")?;
    if package["tab"]["distribution"]["sha256"].as_str() != Some(io::digest(&bytes).as_str()) {
        return Err(invalid("tab archive SHA-256 mismatch"));
    }
    let files = cadencr_registry_core::read_tab_archive_bytes(&bytes).map_err(invalid)?;
    let manifest = storage::verify_identity(&package, &files)?;
    storage::commit(
        &root,
        &storage::Receipt {
            index: body.index,
            id: body.tab_id.clone(),
            version: body.version.clone(),
        },
        &bytes,
        &files,
    )?;
    // Installing never grants consent or switches the tab on. The existing runtime
    // compares the new manifest's permissions hash before issuing a grant.
    Ok(ManagedTabInventoryEntry {
        id: body.tab_id,
        version: body.version,
        name: manifest.name,
        error: None,
    })
}

pub async fn remove(id: String) -> Result<(), AppError> {
    let root = storage::root();
    let _guard = MUTATION.lock().await;
    tokio::task::spawn_blocking(move || storage::deactivate(&root, &id))
        .await
        .map_err(invalid)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installer_admits_signed_bytes_and_preserves_local_author_tabs() {
        let temp = tempfile::tempdir().unwrap();
        let (receipt, archive, _, trust) = super::storage::fixtures::fixture(temp.path());
        let body = InstallManagedTabRequest {
            index: receipt.index.clone(),
            tab_id: "graph".into(),
            version: "1.0.0".into(),
        };
        let root = temp.path().join("managed");
        let local = temp.path().join("authors/graph");
        let call = |bytes: Vec<u8>, update: bool| {
            io::with_root(temp.path().join("themes"), || {
                install_bytes()
                    .root(root.clone())
                    .local(local.clone())
                    .body(body.clone())
                    .bytes(bytes)
                    .update(update)
                    .trust(&trust)
                    .call()
            })
        };
        assert!(call(b"tampered".to_vec(), false).is_err());
        assert!(storage::directory(&root, "graph").unwrap().is_none());
        assert_eq!(call(archive.clone(), false).unwrap().version, "1.0.0");
        assert!(call(archive.clone(), false).is_err());
        assert!(call(archive.clone(), true).is_ok());
        storage::read_trusted(&root, "graph", &trust).unwrap();
        std::fs::create_dir_all(&local).unwrap();
        std::fs::write(local.join("source.ts"), "author work").unwrap();
        assert!(call(archive, true).is_err());
        assert_eq!(
            std::fs::read_to_string(local.join("source.ts")).unwrap(),
            "author work"
        );
    }
}
