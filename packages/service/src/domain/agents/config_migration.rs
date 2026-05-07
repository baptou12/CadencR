use std::io;
use std::path::{Component, Path, PathBuf};

use tokio::fs;

pub async fn copy_provider_config_paths(
    provider_label: &str,
    source_root: &Path,
    dest_root: &Path,
    relative_paths: &[&str],
) -> Result<(), super::adapter::RuntimeError> {
    copy_missing_provider_paths(source_root, dest_root, relative_paths)
        .await
        .map_err(|error| {
            super::adapter::RuntimeError::new(format!(
                "failed to migrate {provider_label} config into worktree: {error}"
            ))
        })
}

pub async fn copy_missing_provider_paths(
    source_root: &Path,
    dest_root: &Path,
    relative_paths: &[&str],
) -> io::Result<()> {
    for relative in relative_paths {
        let relative_path = validate_relative_path(relative)?;
        copy_missing_path(
            &source_root.join(&relative_path),
            &dest_root.join(&relative_path),
        )
        .await?;
    }
    Ok(())
}

async fn copy_missing_path(source: &Path, dest: &Path) -> io::Result<()> {
    let metadata = match fs::metadata(source).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };

    if path_exists(dest).await? {
        if metadata.is_dir() {
            copy_missing_directory_entries(source, dest).await?;
        }
        return Ok(());
    }

    if metadata.is_dir() {
        fs::create_dir_all(dest).await?;
        copy_missing_directory_entries(source, dest).await
    } else {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::copy(source, dest).await.map(|_| ())
    }
}

async fn copy_missing_directory_entries(source: &Path, dest: &Path) -> io::Result<()> {
    let mut pending = vec![(source.to_path_buf(), dest.to_path_buf())];

    while let Some((source_dir, dest_dir)) = pending.pop() {
        fs::create_dir_all(&dest_dir).await?;
        let mut entries = fs::read_dir(&source_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let entry_source = entry.path();
            let entry_dest = dest_dir.join(entry.file_name());

            let entry_type = entry.file_type().await?;
            if path_exists(&entry_dest).await? {
                if entry_type.is_dir() {
                    pending.push((entry_source, entry_dest));
                }
                continue;
            }

            if entry_type.is_dir() {
                pending.push((entry_source, entry_dest));
            } else {
                fs::copy(&entry_source, &entry_dest).await?;
            }
        }
    }

    Ok(())
}

async fn path_exists(path: &Path) -> io::Result<bool> {
    match fs::metadata(path).await {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn validate_relative_path(relative: &str) -> io::Result<PathBuf> {
    let path = Path::new(relative);
    if path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("provider config path must be relative: {relative}"),
        ));
    }
    Ok(path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn copy_policy_copies_missing_file_and_skips_existing_destination() {
        let source = tempdir().unwrap();
        let dest = tempdir().unwrap();
        tokio::fs::create_dir_all(source.path().join(".claude"))
            .await
            .unwrap();
        tokio::fs::create_dir_all(dest.path().join(".claude"))
            .await
            .unwrap();
        tokio::fs::write(source.path().join(".claude/settings.local.json"), "source")
            .await
            .unwrap();
        tokio::fs::write(dest.path().join(".claude/settings.local.json"), "dest")
            .await
            .unwrap();

        copy_missing_provider_paths(source.path(), dest.path(), &[".claude/settings.local.json"])
            .await
            .unwrap();

        let content = tokio::fs::read_to_string(dest.path().join(".claude/settings.local.json"))
            .await
            .unwrap();
        assert_eq!(content, "dest");
    }

    #[tokio::test]
    async fn copy_policy_recursively_copies_only_missing_directory_entries() {
        let source = tempdir().unwrap();
        let dest = tempdir().unwrap();
        tokio::fs::create_dir_all(source.path().join(".codex/agents/nested"))
            .await
            .unwrap();
        tokio::fs::create_dir_all(dest.path().join(".codex/agents/nested"))
            .await
            .unwrap();
        tokio::fs::write(source.path().join(".codex/agents/new.md"), "new")
            .await
            .unwrap();
        tokio::fs::write(source.path().join(".codex/agents/existing.md"), "source")
            .await
            .unwrap();
        tokio::fs::write(dest.path().join(".codex/agents/existing.md"), "dest")
            .await
            .unwrap();
        tokio::fs::write(
            source.path().join(".codex/agents/nested/missing.md"),
            "nested",
        )
        .await
        .unwrap();

        copy_missing_provider_paths(source.path(), dest.path(), &[".codex/agents"])
            .await
            .unwrap();

        assert_eq!(
            tokio::fs::read_to_string(dest.path().join(".codex/agents/new.md"))
                .await
                .unwrap(),
            "new"
        );
        assert_eq!(
            tokio::fs::read_to_string(dest.path().join(".codex/agents/existing.md"))
                .await
                .unwrap(),
            "dest"
        );
        assert_eq!(
            tokio::fs::read_to_string(dest.path().join(".codex/agents/nested/missing.md"))
                .await
                .unwrap(),
            "nested"
        );
    }
}
