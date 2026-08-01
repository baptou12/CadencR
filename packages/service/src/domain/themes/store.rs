//! Read/write user themes under `~/.cadencr/themes/<id>/theme.json`.
//!
//! Reads always go to disk (no cache) so an external edit shows up on the next
//! request, matching how the settings store behaves. Writes are atomic
//! (temp file + rename) so a reader — or the file watcher — never sees a
//! half-written theme.

use std::collections::BTreeMap;
use std::path::Path;

use tokio::fs;

use crate::error::AppError;

use super::models::{ThemeAppearance, ThemeDocument, ThemeIssue, UserTheme, XtermPalette};
use super::paths::{self, THEME_FILE_NAME};
use super::validate::validate;
use crate::shared::slug::slugify;

/// Every theme on disk, id-sorted, each with its validation verdict.
pub async fn list() -> Result<Vec<UserTheme>, AppError> {
    let dir = paths::themes_dir();
    let mut entries = match fs::read_dir(&dir).await {
        Ok(entries) => entries,
        // No themes dir yet simply means no user themes.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(AppError::Internal(format!(
                "failed to read {}: {e}",
                dir.display()
            )))
        }
    };

    let mut ids = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Internal(format!("failed to read {}: {e}", dir.display())))?
    {
        let Some(id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if paths::is_valid_id(&id) {
            ids.push(id);
        }
    }
    ids.sort();

    // A directory without a `theme.json` isn't a theme — skip it rather than
    // failing the whole listing over one stray folder.
    let mut themes = Vec::with_capacity(ids.len());
    for id in ids {
        match get(&id).await {
            Ok(theme) => themes.push(theme),
            Err(AppError::NotFound(_)) => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(themes)
}

/// Read one theme, validating it. A theme whose file is missing is a 404; a
/// theme whose file is *broken* is not — it is returned with its issues so the
/// gallery can show the user what to fix.
pub async fn get(id: &str) -> Result<UserTheme, AppError> {
    let path = paths::theme_file(id)?;
    let content = fs::read_to_string(&path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound(format!("theme `{id}` not found"))
        } else {
            AppError::Internal(format!("failed to read {}: {e}", path.display()))
        }
    })?;
    Ok(build(id, &path, content))
}

fn build(id: &str, path: &Path, content: String) -> UserTheme {
    let (label, theme, issues) = match serde_json::from_str::<ThemeDocument>(&content) {
        Ok(document) => {
            let issues = validate(&document);
            let label = Some(document.label.clone());
            if issues.is_empty() {
                (label, Some(document), issues)
            } else {
                // Keep the label but drop the document: a theme that failed
                // validation must never be applicable, and the gallery still
                // needs to name it.
                (label, None, issues)
            }
        }
        Err(e) => (None, None, vec![ThemeIssue::document(e.to_string())]),
    };
    UserTheme {
        id: id.to_string(),
        path: path.display().to_string(),
        content,
        label,
        theme,
        issues,
    }
}

/// Create a theme from a duplicated token set. Rejects an invalid document
/// outright — this path is machine-generated from a working theme, so anything
/// invalid here is a bug, not a user edit in progress.
pub async fn create(
    label: &str,
    appearance: ThemeAppearance,
    css_vars: BTreeMap<String, String>,
    xterm: XtermPalette,
) -> Result<UserTheme, AppError> {
    let document = ThemeDocument {
        label: label.trim().to_string(),
        appearance,
        css_vars,
        xterm,
    };
    let issues = validate(&document);
    if let Some(first) = issues.first() {
        return Err(AppError::BadRequest(format!(
            "theme is not valid: {}",
            first.describe()
        )));
    }

    // `slugify` yields "" for a label with no alphanumerics; an id has to be a
    // usable path segment, so fall back rather than fail the create.
    let slug = slugify(&document.label);
    let base = if slug.is_empty() { "theme" } else { &slug };
    let id = next_available_id(base).await?;
    let content = serde_json::to_string_pretty(&document)
        .map_err(|e| AppError::Internal(format!("failed to serialize theme: {e}")))?;
    write_file(&id, &format!("{content}\n")).await?;
    get(&id).await
}

/// Replace a theme's file with `content` verbatim.
///
/// Deliberately accepts content that fails validation: the user is editing, and
/// a rejected save would mean a half-finished edit could never be persisted.
/// The returned theme carries the issues, and an invalid theme is simply never
/// applied — the gate lives on load, where it protects the UI.
pub async fn write(id: &str, content: &str) -> Result<UserTheme, AppError> {
    // Read first so an unknown id is a 404 rather than a silent create: `write`
    // replaces an existing theme, `create` makes new ones.
    get(id).await?;
    write_file(id, content).await?;
    get(id).await
}

pub async fn delete(id: &str) -> Result<(), AppError> {
    let dir = paths::theme_dir(id)?;
    fs::remove_dir_all(&dir).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound(format!("theme `{id}` not found"))
        } else {
            AppError::Internal(format!("failed to delete {}: {e}", dir.display()))
        }
    })
}

/// Append `-2`, `-3`, … until the slug is free, so duplicating the same theme
/// twice never overwrites the first copy.
async fn next_available_id(base: &str) -> Result<String, AppError> {
    for suffix in 1..1000 {
        let candidate = if suffix == 1 {
            base.to_string()
        } else {
            format!("{base}-{suffix}")
        };
        if fs::metadata(paths::theme_dir(&candidate)?).await.is_err() {
            return Ok(candidate);
        }
    }
    Err(AppError::Internal(
        "could not find an unused theme id".into(),
    ))
}

/// Atomic write into an owner-only (`0700`) theme directory.
async fn write_file(id: &str, content: &str) -> Result<(), AppError> {
    let dir = paths::theme_dir(id)?;
    let path = dir.join(THEME_FILE_NAME);
    crate::remote::secure_fs::create_dir_owner_only(&dir)
        .map_err(|e| AppError::Internal(format!("failed to create {}: {e}", dir.display())))?;
    // Dot-prefixed so the watcher's filter skips it (it only reports
    // `theme.json`), keeping our own write from racing a reload of a partial file.
    crate::shared::atomic_file::write_atomic(&path, content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::themes::test_support::{dracula_css_vars, dracula_xterm};

    async fn create_dracula(label: &str) -> UserTheme {
        create(
            label,
            ThemeAppearance::Dark,
            dracula_css_vars(),
            dracula_xterm(),
        )
        .await
        .expect("creates")
    }

    #[tokio::test]
    async fn listing_an_absent_themes_dir_is_empty_not_an_error() {
        assert!(list().await.expect("lists").is_empty());
    }

    #[tokio::test]
    async fn creates_reads_and_deletes_a_theme() {
        let created = create_dracula("My Theme").await;
        assert_eq!(created.id, "my-theme");
        assert!(created.issues.is_empty());
        assert_eq!(created.theme.expect("valid").label, "My Theme");

        let listed = list().await.expect("lists");
        assert_eq!(listed.len(), 1);
        assert!(listed[0].path.ends_with("my-theme/theme.json"));

        delete("my-theme").await.expect("deletes");
        assert!(list().await.expect("lists").is_empty());
        assert!(get("my-theme").await.is_err());
    }

    #[tokio::test]
    async fn duplicating_the_same_label_never_overwrites() {
        assert_eq!(create_dracula("My Theme").await.id, "my-theme");
        assert_eq!(create_dracula("My Theme").await.id, "my-theme-2");
        assert_eq!(list().await.expect("lists").len(), 2);
    }

    #[tokio::test]
    async fn a_broken_file_is_listed_with_issues_and_never_applied() {
        let created = create_dracula("My Theme").await;
        // Exactly what a user editing the file on disk does: break one value,
        // leaving the document itself perfectly good JSON.
        let mut document = created.theme.expect("valid");
        document
            .css_vars
            .insert("--background".into(), "hsl(var(--foreground))".into());
        let broken = serde_json::to_string_pretty(&document).expect("serializes");

        let theme = write("my-theme", &broken).await.expect("writes anyway");
        assert!(
            theme.theme.is_none(),
            "invalid theme must not be applicable"
        );
        assert!(!theme.issues.is_empty());
        assert_eq!(
            theme.label.as_deref(),
            Some("My Theme"),
            "a broken theme must still be nameable in the gallery"
        );

        // Still listed, so the gallery can show the user what to fix.
        let listed = list().await.expect("lists");
        assert_eq!(listed.len(), 1);
        assert!(listed[0].theme.is_none());
    }

    #[tokio::test]
    async fn a_file_that_is_not_json_reports_a_document_level_issue() {
        create_dracula("My Theme").await;
        let theme = write("my-theme", "{ nope").await.expect("writes anyway");
        assert!(theme.theme.is_none());
        assert_eq!(theme.label, None, "an unparseable file has no name to show");
        assert_eq!(theme.issues.len(), 1);
        assert_eq!(theme.issues[0].token, None);
    }

    #[tokio::test]
    async fn writing_or_deleting_an_unknown_theme_is_a_404() {
        assert!(write("nope", "{}").await.is_err());
        assert!(delete("nope").await.is_err());
    }

    #[tokio::test]
    async fn rejects_creating_an_invalid_theme() {
        let mut css_vars = dracula_css_vars();
        css_vars.remove("--background");
        let error = create("Broken", ThemeAppearance::Dark, css_vars, dracula_xterm())
            .await
            .expect_err("must reject");
        assert!(error.to_string().contains("--background"), "{error}");
    }
}
