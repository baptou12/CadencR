//! The local tabs on disk: one validated folder report per `<tabs>/<id>/`.
//!
//! Stateless on purpose — every call rescans. Folders are few and small (the
//! manifest is bounded at 64 KiB, the icon at 32 KiB), and reading fresh means
//! an agent rewriting `tab.json` is reflected by the very next request with no
//! cache to invalidate. The watcher only tells clients *when* to ask.

use std::path::Path;

use axum::http::StatusCode;
use cadencr_plugin_core::tab::{inspect_tab_folder, TabFolderReport, TabManifest};

use super::paths;
use crate::error::AppError;

/// One custom tab folder as Cadencr sees it.
#[derive(Debug, Clone)]
pub struct LocalTab {
    /// The folder name, which a valid manifest's `id` equals.
    pub id: String,
    pub report: TabFolderReport,
}

impl LocalTab {
    /// The parsed manifest, even when it failed a rule.
    pub fn manifest(&self) -> Option<&TabManifest> {
        self.report.manifest.as_ref()
    }

    /// The manifest only when it passed every rule — the one a tab may run with.
    pub fn valid_manifest(&self) -> Option<&TabManifest> {
        self.report.valid_manifest()
    }

    /// Hash of the current permissions and origins (see `plugin-core::tab::hash`);
    /// `None` when `tab.json` could not be parsed.
    pub fn permissions_hash(&self) -> Option<String> {
        self.manifest().map(TabManifest::permissions_hash)
    }

    /// The valid manifest and its hash, or `PLUGIN_TAB_INVALID`.
    pub fn require_valid(&self) -> Result<(&TabManifest, String), AppError> {
        let manifest = self.valid_manifest().ok_or_else(|| {
            AppError::coded(
                StatusCode::UNPROCESSABLE_ENTITY,
                "PLUGIN_TAB_INVALID",
                format!(
                    "custom tab `{}` has an invalid tab.json: {}",
                    self.id,
                    self.report.findings.describe_errors()
                ),
            )
        })?;
        Ok((manifest, manifest.permissions_hash()))
    }
}

/// Every tab folder, sorted by id. Dot-folders are skipped; anything else that
/// is a directory is listed, valid or not, so a broken tab is visible.
pub async fn list() -> Result<Vec<LocalTab>, AppError> {
    let root = paths::tabs_dir();
    let managed_root = super::managed::storage::root();
    tokio::task::spawn_blocking(move || {
        let mut tabs = scan(&root)?;
        for id in super::managed::storage::ids(&managed_root)? {
            if tabs.iter().any(|tab| tab.id == id) {
                continue;
            }
            let report = match super::managed::storage::directory(&managed_root, &id) {
                Ok(None) => continue,
                Ok(Some(dir)) => match super::managed::storage::read(&managed_root, &id) {
                    Ok(_) => inspect_tab_folder(&dir),
                    Err(error) => unavailable_report(dir, error),
                },
                Err(error) => {
                    unavailable_report(super::managed::storage::owner(&managed_root, &id)?, error)
                }
            };
            tabs.push(LocalTab { id, report });
        }
        tabs.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(tabs)
    })
    .await
    .map_err(|error| AppError::Internal(format!("custom tab scan failed: {error}")))?
}

fn unavailable_report(directory: std::path::PathBuf, error: AppError) -> TabFolderReport {
    use cadencr_plugin_core::tab::{TabFindings, TabIssue, TabIssueCode};
    TabFolderReport {
        directory,
        manifest: None,
        icon_svg: None,
        entry_present: false,
        findings: TabFindings {
            errors: vec![TabIssue::document(
                TabIssueCode::ManifestUnreadable,
                error.to_string(),
            )],
            warnings: Vec::new(),
        },
    }
}

/// One tab by id; `PLUGIN_TAB_NOT_FOUND` when its folder does not exist.
pub async fn get(id: &str) -> Result<LocalTab, AppError> {
    let dir = paths::plugin_dir(id)?;
    let managed_root = super::managed::storage::root();
    let id = id.to_string();
    tokio::task::spawn_blocking(move || {
        if dir.starts_with(&managed_root) {
            super::managed::storage::read(&managed_root, &id)?;
        }
        if !dir.is_dir() {
            return Err(not_found(&id));
        }
        Ok(LocalTab {
            report: inspect_tab_folder(&dir),
            id,
        })
    })
    .await
    .map_err(|error| AppError::Internal(format!("custom tab read failed: {error}")))?
}

pub fn not_found(id: &str) -> AppError {
    AppError::coded(
        StatusCode::NOT_FOUND,
        "PLUGIN_TAB_NOT_FOUND",
        format!("no custom tab `{id}`"),
    )
}

fn scan(root: &Path) -> Result<Vec<LocalTab>, AppError> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(AppError::Internal(format!(
                "cannot read the custom tabs folder {}: {error}",
                root.display()
            )))
        }
    };
    let mut tabs = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| {
            AppError::Internal(format!("cannot read the custom tabs folder: {error}"))
        })?;
        let Some(id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if id.starts_with('.') || !entry.path().is_dir() {
            continue;
        }
        tabs.push(LocalTab {
            report: inspect_tab_folder(&entry.path()),
            id,
        });
    }
    tabs.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(tabs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::plugin_tabs::test_support::write_tab;

    #[tokio::test]
    async fn lists_valid_and_invalid_folders_and_skips_dot_folders() {
        assert!(
            list().await.unwrap().is_empty(),
            "missing root lists nothing"
        );
        write_tab("graph", serde_json::json!({}));
        write_tab("broken", serde_json::json!({"id": "other"}));
        std::fs::create_dir_all(paths::tabs_dir().join(".trash")).unwrap();
        std::fs::write(paths::tabs_dir().join("stray.txt"), "x").unwrap();
        let tabs = list().await.unwrap();
        let ids: Vec<&str> = tabs.iter().map(|tab| tab.id.as_str()).collect();
        assert_eq!(ids, ["broken", "graph"]);
        assert!(tabs[0].valid_manifest().is_none());
        assert!(tabs[0].require_valid().is_err());
        assert!(tabs[1].require_valid().is_ok());
    }

    #[tokio::test]
    async fn get_distinguishes_missing_from_invalid_ids() {
        write_tab("graph", serde_json::json!({}));
        assert_eq!(get("graph").await.unwrap().id, "graph");
        assert!(matches!(
            get("absent").await,
            Err(AppError::Coded {
                code: "PLUGIN_TAB_NOT_FOUND",
                ..
            })
        ));
        assert!(matches!(
            get("../graph").await,
            Err(AppError::Coded {
                code: "PLUGIN_TAB_ID_INVALID",
                ..
            })
        ));
    }
    #[tokio::test]
    async fn a_broken_marketplace_revision_does_not_hide_local_tabs() {
        write_tab("local", serde_json::json!({}));
        let root = super::super::managed::storage::root();
        let owner = super::super::managed::storage::owner(&root, "broken").unwrap();
        super::super::managed::storage::secure(&root, &owner).unwrap();
        super::super::managed::storage::write_file(
            &owner.join("active.json"),
            br#""invalid-revision""#,
        )
        .unwrap();
        let tabs = list().await.unwrap();
        assert_eq!(tabs.len(), 2);
        assert!(tabs
            .iter()
            .find(|tab| tab.id == "local")
            .unwrap()
            .valid_manifest()
            .is_some());
        let broken = tabs.iter().find(|tab| tab.id == "broken").unwrap();
        assert!(broken.valid_manifest().is_none());
        assert!(!broken.report.findings.errors.is_empty());
    }
}
