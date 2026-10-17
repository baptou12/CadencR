//! Inspect one tab folder: the manifest, its icon and whether the entry is built.
//!
//! Never fails as a whole. A folder that cannot be read is still a folder the
//! user put there, so it comes back with findings rather than vanishing from
//! the list.

use std::path::{Path, PathBuf};

use super::issues::{TabFindings, TabIssue, TabIssueCode as Code};
use super::manifest::TabManifest;
use super::validate::{is_clean_relative_path, validate_manifest};
use super::{MANIFEST_FILE_NAME, MAX_ICON_BYTES, MAX_MANIFEST_BYTES};

#[derive(Debug, Clone)]
pub struct TabFolderReport {
    /// The folder, canonicalized when it resolves.
    pub directory: PathBuf,
    /// `None` when `tab.json` is missing, unreadable or not a manifest.
    pub manifest: Option<TabManifest>,
    pub findings: TabFindings,
    /// The icon's SVG text when declared, present and within budget.
    pub icon_svg: Option<String>,
    /// Whether `entry` resolves to a regular file inside the folder.
    pub entry_present: bool,
}

impl TabFolderReport {
    /// A manifest that parsed and passed every rule.
    pub fn valid_manifest(&self) -> Option<&TabManifest> {
        self.manifest.as_ref().filter(|_| self.findings.is_valid())
    }
}

/// Read and validate `<directory>/tab.json`. The folder name must equal the
/// manifest's `id`.
pub fn inspect_tab_folder(directory: &Path) -> TabFolderReport {
    let folder_name = directory
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let mut report = TabFolderReport {
        directory: directory.to_path_buf(),
        manifest: None,
        findings: TabFindings::default(),
        icon_svg: None,
        entry_present: false,
    };
    let root = match directory.canonicalize() {
        Ok(root) if root.is_dir() => root,
        Ok(_) => return unreadable(report, "the tab folder is not a directory"),
        Err(error) => return unreadable(report, format!("cannot open the tab folder: {error}")),
    };
    report.directory = root.clone();
    let bytes = match read_bounded(&root, MANIFEST_FILE_NAME, MAX_MANIFEST_BYTES) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => return unreadable(report, format!("{MANIFEST_FILE_NAME} is missing")),
        Err(reason) => return unreadable(report, reason),
    };
    let manifest: TabManifest = match serde_json::from_slice(&bytes) {
        Ok(manifest) => manifest,
        Err(error) => {
            report.findings.errors.push(TabIssue::document(
                Code::ManifestInvalidJson,
                format!("{MANIFEST_FILE_NAME}: {error}"),
            ));
            return report;
        }
    };
    report.findings = validate_manifest(&manifest);
    if manifest.id != folder_name {
        report.findings.error(
            Code::IdMismatch,
            "id",
            format!("must equal the folder name `{folder_name}`"),
        );
    }
    report.icon_svg = load_icon(&root, manifest.icon.as_deref(), &mut report.findings);
    report.entry_present =
        is_clean_relative_path(&manifest.entry) && resolve_file(&root, &manifest.entry).is_some();
    report.manifest = Some(manifest);
    report
}

/// Just the parsed `tab.json` — no validation, icon or hash — for a caller
/// that needs one field of it. `None` when it is missing, unreadable or not a
/// manifest; [`inspect_tab_folder`] says why.
pub fn read_tab_manifest(directory: &Path) -> Option<TabManifest> {
    let root = directory.canonicalize().ok()?;
    let bytes = read_bounded(&root, MANIFEST_FILE_NAME, MAX_MANIFEST_BYTES).ok()??;
    serde_json::from_slice(&bytes).ok()
}

fn unreadable(mut report: TabFolderReport, message: impl Into<String>) -> TabFolderReport {
    report
        .findings
        .errors
        .push(TabIssue::document(Code::ManifestUnreadable, message));
    report
}

fn load_icon(root: &Path, icon: Option<&str>, findings: &mut TabFindings) -> Option<String> {
    // The same shape `validate_paths` accepts, so a declared icon that passed
    // validation is always loaded (or reported).
    let icon = icon.filter(|icon| {
        is_clean_relative_path(icon) && icon.to_ascii_lowercase().ends_with(".svg")
    })?;
    let bytes = match read_bounded(root, icon, MAX_ICON_BYTES) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => {
            findings.warning(
                Code::IconMissing,
                "icon",
                format!("`{icon}` does not exist"),
            );
            return None;
        }
        Err(reason) => {
            findings.error(Code::IconInvalid, "icon", reason);
            return None;
        }
    };
    match String::from_utf8(bytes) {
        Ok(svg) if svg.contains("<svg") => Some(svg),
        _ => {
            findings.error(Code::IconInvalid, "icon", "is not an SVG document");
            None
        }
    }
}

/// `root/relative` when it canonicalizes to a regular file inside `root`.
pub(crate) fn resolve_file(root: &Path, relative: &str) -> Option<PathBuf> {
    let path = root.join(relative).canonicalize().ok()?;
    (path.starts_with(root) && path.is_file()).then_some(path)
}

/// `Ok(None)` when the file does not exist. Refuses symlinks, non-regular
/// files, files outside `root` and files over `limit` bytes.
fn read_bounded(root: &Path, relative: &str, limit: u64) -> Result<Option<Vec<u8>>, String> {
    let path = root.join(relative);
    match std::fs::symlink_metadata(&path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("cannot inspect `{relative}`: {error}")),
    }
    // Containment of the parent directories; the file itself is never
    // followed (`read_regular_bounded` refuses a symlink).
    if resolve_file(root, relative).is_none() {
        return Err(format!(
            "`{relative}` must be a regular file inside the tab folder, not a symlink"
        ));
    }
    crate::read_regular_bounded(&path, limit)
        .map(Some)
        .map_err(|error| format!("`{relative}` {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tab::test_support::{codes, manifest_json};
    use serde_json::json;

    fn folder(id: &str, overrides: serde_json::Value) -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join(id);
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(
            dir.join(MANIFEST_FILE_NAME),
            serde_json::to_vec(&manifest_json(overrides)).unwrap(),
        )
        .unwrap();
        (root, dir)
    }

    #[test]
    fn a_complete_folder_reports_icon_entry_and_hash() {
        let (_root, dir) = folder("changed-files-graph", json!({}));
        std::fs::write(dir.join("icon.svg"), "<svg viewBox=\"0 0 24 24\"></svg>").unwrap();
        std::fs::create_dir(dir.join("dist")).unwrap();
        std::fs::write(dir.join("dist/index.html"), "<!doctype html>").unwrap();
        let report = inspect_tab_folder(&dir);
        assert!(report.findings.is_valid(), "{:?}", report.findings);
        assert!(report.valid_manifest().is_some());
        assert!(report.icon_svg.unwrap().starts_with("<svg"));
        assert!(report.entry_present);
    }

    #[test]
    fn read_tab_manifest_parses_without_validating() {
        let (_root, dir) = folder("other", json!({}));
        let manifest = read_tab_manifest(&dir).unwrap();
        assert_eq!(manifest.entry, "dist/index.html");
        std::fs::write(dir.join(MANIFEST_FILE_NAME), "{").unwrap();
        assert!(read_tab_manifest(&dir).is_none());
    }

    #[test]
    fn missing_build_and_icon_are_not_errors() {
        let (_root, dir) = folder("changed-files-graph", json!({}));
        let report = inspect_tab_folder(&dir);
        assert!(report.findings.is_valid());
        assert!(!report.entry_present);
        assert_eq!(codes(&report.findings.warnings), ["ICON_MISSING"]);
    }

    #[test]
    fn folder_name_must_match_the_id() {
        let (_root, dir) = folder("other", json!({}));
        let report = inspect_tab_folder(&dir);
        assert!(codes(&report.findings.errors).contains(&"ID_MISMATCH"));
        assert!(report.manifest.is_some());
        assert!(report.valid_manifest().is_none());
    }

    #[test]
    fn unreadable_and_malformed_manifests_are_reported() {
        let root = tempfile::tempdir().unwrap();
        let empty = root.path().join("empty");
        std::fs::create_dir(&empty).unwrap();
        assert_eq!(
            codes(&inspect_tab_folder(&empty).findings.errors),
            ["MANIFEST_UNREADABLE"]
        );
        std::fs::write(empty.join(MANIFEST_FILE_NAME), "{ nope").unwrap();
        let report = inspect_tab_folder(&empty);
        assert_eq!(codes(&report.findings.errors), ["MANIFEST_INVALID_JSON"]);
        assert!(report.manifest.is_none());
        let (_other, dir) = folder("x", json!({"script": "evil.js"}));
        assert_eq!(
            codes(&inspect_tab_folder(&dir).findings.errors),
            ["MANIFEST_INVALID_JSON"]
        );
    }

    #[test]
    fn oversized_or_non_svg_icons_are_errors() {
        let (_root, dir) = folder("changed-files-graph", json!({}));
        std::fs::write(dir.join("icon.svg"), "x".repeat(32 * 1024 + 1)).unwrap();
        assert_eq!(
            codes(&inspect_tab_folder(&dir).findings.errors),
            ["ICON_INVALID"]
        );
        std::fs::write(dir.join("icon.svg"), "not an svg").unwrap();
        assert_eq!(
            codes(&inspect_tab_folder(&dir).findings.errors),
            ["ICON_INVALID"]
        );
    }

    #[test]
    fn an_upper_case_svg_icon_is_loaded() {
        let (_root, dir) = folder("changed-files-graph", json!({"icon": "Icon.SVG"}));
        std::fs::write(dir.join("Icon.SVG"), "<svg viewBox=\"0 0 24 24\"></svg>").unwrap();
        let report = inspect_tab_folder(&dir);
        assert!(report.findings.is_valid(), "{:?}", report.findings);
        assert!(report.icon_svg.is_some());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_smuggle_files_from_outside() {
        use std::os::unix::fs::symlink;
        let (_root, dir) = folder("changed-files-graph", json!({}));
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("secret.svg");
        std::fs::write(&secret, "<svg>secret</svg>").unwrap();
        symlink(&secret, dir.join("icon.svg")).unwrap();
        symlink(outside.path(), dir.join("dist")).unwrap();
        std::fs::write(outside.path().join("index.html"), "x").unwrap();
        let report = inspect_tab_folder(&dir);
        assert!(report.icon_svg.is_none());
        assert_eq!(codes(&report.findings.errors), ["ICON_INVALID"]);
        assert!(!report.entry_present);
    }
}
