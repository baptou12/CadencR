//! Read/write API over the settings files. Dir-based core functions are pure
//! (testable with temp dirs); the `global_*`/`project_*` wrappers resolve the
//! active settings dir from `dir::global_dir()`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use sqlx::SqlitePool;

use crate::domain::projects::models::ProjectSetting;
use crate::domain::workspace::models::Setting;
use crate::error::AppError;

use super::{dir, file, lock, paths, validate, Scope, SettingWarning};

/// Read + parse + validate a settings file. Never errors: a missing file is an
/// empty map, and a malformed file degrades to an empty map plus a warning so a
/// corrupt file can't brick the app on a hot read path.
pub fn load(path: &Path, scope: Scope) -> (BTreeMap<String, String>, Vec<SettingWarning>) {
    match file::read_file(path) {
        Ok(Some(text)) => load_text(scope, &text),
        Ok(None) => (BTreeMap::new(), Vec::new()),
        Err(e) => (
            BTreeMap::new(),
            vec![SettingWarning::new("", e.to_string())],
        ),
    }
}

/// Parse + validate already-read document text. Split out so `read_for_edit`
/// can reuse this pass without reading the same file from disk a second time.
fn load_text(scope: Scope, text: &str) -> (BTreeMap<String, String>, Vec<SettingWarning>) {
    let (parsed, mut warnings) = match file::parse_object(text) {
        Ok(result) => result,
        Err(message) => return (BTreeMap::new(), vec![SettingWarning::new("", message)]),
    };
    let (clean, mut validation_warnings) = validate::validate(scope, parsed);
    warnings.append(&mut validation_warnings);
    (clean, warnings)
}

/// Read the raw stored map (all keys preserved, no default substitution) for a
/// read-modify-write. Errors if the existing file isn't valid JSON so a single
/// key write never silently clobbers a file a user is mid-edit on.
fn load_raw_for_write(path: &Path) -> Result<BTreeMap<String, String>, AppError> {
    match file::read_file(path)? {
        Some(text) => {
            let (map, _warnings) = file::parse_object(&text).map_err(|message| {
                AppError::BadRequest(format!(
                    "{} is not valid JSON ({message}); fix it via \"Edit JSON\" before changing settings",
                    path.display()
                ))
            })?;
            Ok(map)
        }
        None => Ok(BTreeMap::new()),
    }
}

/// Set a single key, preserving every other key (including unknown ones).
async fn set_value(path: &Path, key: &str, value: &str) -> Result<(), AppError> {
    let _guard = lock::write_lock().lock().await;
    let mut map = load_raw_for_write(path)?;
    map.insert(key.to_string(), value.to_string());
    file::write_atomic(path, &file::serialize_map(&map))
}

/// Validate and atomically write a full settings document (the "Edit JSON" save
/// path). Returns warnings; errors only on invalid JSON.
async fn write_content(
    path: &Path,
    scope: Scope,
    content: &str,
) -> Result<Vec<SettingWarning>, AppError> {
    let (map, mut warnings) = file::parse_object(content).map_err(AppError::BadRequest)?;
    let (_clean, mut validation_warnings) = validate::validate(scope, map.clone());
    warnings.append(&mut validation_warnings);

    let _guard = lock::write_lock().lock().await;
    file::write_atomic(path, &file::serialize_map(&map))?;
    Ok(warnings)
}

/// Current document text for the editor, plus warnings. Empty file → `{}`.
pub fn read_for_edit(path: &Path, scope: Scope) -> (String, Vec<SettingWarning>) {
    match file::read_file(path) {
        Ok(Some(text)) if !text.trim().is_empty() => {
            let (_map, warnings) = load_text(scope, &text);
            (text, warnings)
        }
        Ok(_) => ("{}\n".to_string(), Vec::new()),
        Err(e) => (
            "{}\n".to_string(),
            vec![SettingWarning::new("", e.to_string())],
        ),
    }
}

// ---------------------------------------------------------------------------
// Global (workspace) wrappers
// ---------------------------------------------------------------------------

fn global_path() -> PathBuf {
    paths::global_file(&dir::global_dir())
}

pub fn global_get(key: &str) -> Option<String> {
    load(&global_path(), Scope::Workspace).0.remove(key)
}

/// Like `global_get` but treats empty/whitespace-only as unset.
pub fn global_get_nonempty(key: &str) -> Option<String> {
    global_get(key).filter(|v| !v.trim().is_empty())
}

pub fn global_list() -> Vec<Setting> {
    load(&global_path(), Scope::Workspace)
        .0
        .into_iter()
        .map(|(key, value)| Setting {
            key,
            value: Some(value),
        })
        .collect()
}

pub async fn global_set(key: &str, value: &str) -> Result<(), AppError> {
    set_value(&global_path(), key, value).await
}

pub async fn global_write_content(content: &str) -> Result<Vec<SettingWarning>, AppError> {
    write_content(&global_path(), Scope::Workspace, content).await
}

pub fn global_read_for_edit() -> (PathBuf, String, Vec<SettingWarning>) {
    let path = global_path();
    let (content, warnings) = read_for_edit(&path, Scope::Workspace);
    (path, content, warnings)
}

// ---------------------------------------------------------------------------
// Project wrappers
// ---------------------------------------------------------------------------

pub async fn project_path(pool: &SqlitePool, project_id: i64) -> Result<PathBuf, AppError> {
    paths::project_file(&dir::global_dir(), pool, project_id).await
}

pub async fn project_map(
    pool: &SqlitePool,
    project_id: i64,
) -> Result<(BTreeMap<String, String>, Vec<SettingWarning>), AppError> {
    let path = project_path(pool, project_id).await?;
    Ok(load(&path, Scope::Project))
}

pub async fn project_get(
    pool: &SqlitePool,
    project_id: i64,
    key: &str,
) -> Result<Option<String>, AppError> {
    Ok(project_map(pool, project_id).await?.0.remove(key))
}

pub async fn project_list(
    pool: &SqlitePool,
    project_id: i64,
) -> Result<Vec<ProjectSetting>, AppError> {
    let (map, _warnings) = project_map(pool, project_id).await?;
    Ok(map
        .into_iter()
        .map(|(key, value)| ProjectSetting {
            key,
            value: Some(value),
        })
        .collect())
}

pub async fn project_set(
    pool: &SqlitePool,
    project_id: i64,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    let path = project_path(pool, project_id).await?;
    set_value(&path, key, value).await
}

pub async fn project_write_content(
    pool: &SqlitePool,
    project_id: i64,
    content: &str,
) -> Result<Vec<SettingWarning>, AppError> {
    let path = project_path(pool, project_id).await?;
    write_content(&path, Scope::Project, content).await
}

pub async fn project_read_for_edit(
    pool: &SqlitePool,
    project_id: i64,
) -> Result<(PathBuf, String, Vec<SettingWarning>), AppError> {
    let path = project_path(pool, project_id).await?;
    let (content, warnings) = read_for_edit(&path, Scope::Project);
    Ok((path, content, warnings))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn set_preserves_other_and_unknown_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        set_value(&path, "theme_current", "tokyo-night")
            .await
            .unwrap();
        set_value(&path, "totally_made_up", "keepme").await.unwrap();
        set_value(&path, "editor_auto_save", "false").await.unwrap();

        let (map, _w) = load(&path, Scope::Workspace);
        assert_eq!(
            map.get("theme_current").map(String::as_str),
            Some("tokyo-night")
        );
        assert_eq!(
            map.get("editor_auto_save").map(String::as_str),
            Some("false")
        );
        // Unknown key survives a write to a sibling key.
        assert_eq!(
            map.get("totally_made_up").map(String::as_str),
            Some("keepme")
        );
    }

    #[tokio::test]
    async fn write_content_returns_warnings_but_persists() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let warnings = write_content(
            &path,
            Scope::Workspace,
            r#"{"editor_auto_save": "maybe", "made_up_key": "x"}"#,
        )
        .await
        .unwrap();
        assert_eq!(warnings.len(), 2);

        // The raw (user) values are persisted verbatim; validation only affects
        // what consumers read back, not the stored file.
        let text = file::read_file(&path).unwrap().unwrap();
        let (raw, _) = file::parse_object(&text).unwrap();
        assert_eq!(
            raw.get("editor_auto_save").map(String::as_str),
            Some("maybe")
        );
        assert_eq!(raw.get("made_up_key").map(String::as_str), Some("x"));

        // But a consumer read substitutes the default for the invalid value.
        let (clean, _) = load(&path, Scope::Workspace);
        assert_eq!(
            clean.get("editor_auto_save").map(String::as_str),
            Some("true")
        );
    }

    #[tokio::test]
    async fn write_content_rejects_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let err = write_content(&path, Scope::Workspace, "{ not json")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[tokio::test]
    async fn set_does_not_clobber_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{ corrupt").unwrap();
        let err = set_value(&path, "theme_current", "x").await.unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
        // Original bytes untouched.
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ corrupt");
    }

    #[test]
    fn load_degrades_gracefully_on_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{ corrupt").unwrap();
        let (map, warnings) = load(&path, Scope::Workspace);
        assert!(map.is_empty());
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn load_reflects_external_edits_immediately() {
        // Reads always hit disk (no cache), so a setting changed by an external
        // editor/script is visible on the very next read.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"theme_current":"aurora"}"#).unwrap();
        assert_eq!(
            load(&path, Scope::Workspace)
                .0
                .get("theme_current")
                .map(String::as_str),
            Some("aurora")
        );
        std::fs::write(&path, r#"{"theme_current":"dracula"}"#).unwrap();
        assert_eq!(
            load(&path, Scope::Workspace)
                .0
                .get("theme_current")
                .map(String::as_str),
            Some("dracula")
        );
    }

    #[tokio::test]
    async fn concurrent_writes_do_not_lose_updates() {
        // Two writers racing on different keys must both land — the write lock
        // serializes the read-modify-write so neither clobbers the other.
        let dir = tempfile::tempdir().unwrap();
        let path = std::sync::Arc::new(dir.path().join("settings.json"));

        let mut handles = Vec::new();
        for i in 0..16 {
            let path = path.clone();
            handles.push(tokio::spawn(async move {
                set_value(&path, &format!("active_tab_{i}"), &i.to_string())
                    .await
                    .unwrap();
            }));
        }
        for h in handles {
            h.await.unwrap();
        }

        let (map, _) = load(&path, Scope::Workspace);
        for i in 0..16 {
            assert_eq!(
                map.get(&format!("active_tab_{i}")).map(String::as_str),
                Some(i.to_string().as_str()),
                "key active_tab_{i} was lost"
            );
        }
    }

    #[test]
    fn read_for_edit_returns_raw_bytes_with_warnings() {
        // The editor must see the user's raw document (not the validated view),
        // while still surfacing warnings for invalid values.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let raw = "{\n  \"editor_auto_save\": \"maybe\"\n}\n";
        std::fs::write(&path, raw).unwrap();

        let (content, warnings) = read_for_edit(&path, Scope::Workspace);
        assert_eq!(content, raw);
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn read_for_edit_missing_file_is_empty_object() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let (content, warnings) = read_for_edit(&path, Scope::Workspace);
        assert_eq!(content, "{}\n");
        assert!(warnings.is_empty());
    }
}
