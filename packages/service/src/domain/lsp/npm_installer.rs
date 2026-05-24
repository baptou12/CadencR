//! Managed npm-package installer for JavaScript/TypeScript language servers.
//!
//! This keeps npm-specific process execution outside the generic downloader
//! while preserving the same managed install root used by native LSP binaries.

use std::path::{Path, PathBuf};

use tokio::process::Command;

use crate::error::AppError;

use super::catalog::{CatalogEntry, HOMEBREW_WELL_KNOWN_ABSOLUTE, NPM_WELL_KNOWN_RELATIVE_TO_HOME};
use super::downloader;

pub async fn install(
    entry: &CatalogEntry,
    version: &str,
    packages: &[&str],
) -> Result<(), AppError> {
    let dir = downloader::install_dir(entry.lsp_id, version)?;
    let bin_path = bin_path_for_dir(&dir, entry.bin_name);
    if bin_path.exists() {
        return Ok(());
    }

    let npm = resolve_npm().await?;
    run_npm_install(&npm, &dir, packages).await?;
    if !bin_path.exists() {
        return Err(AppError::Internal(format!(
            "npm install completed but {} was not created",
            bin_path.display()
        )));
    }
    if let Some(lsp_root) = dir.parent() {
        downloader::gc_old_versions(lsp_root, version);
    }
    Ok(())
}

pub fn bin_path_for_dir(dir: &Path, bin_name: &str) -> PathBuf {
    dir.join("node_modules").join(".bin").join(bin_name)
}

async fn resolve_npm() -> Result<PathBuf, AppError> {
    let spec = cli_discovery::DiscoverySpec {
        bin_name: "npm",
        well_known_relative_to_home: NPM_WELL_KNOWN_RELATIVE_TO_HOME.to_vec(),
        well_known_absolute: npm_well_known_absolute(),
        version_args: &["--version"],
        version_must_contain: None,
    };
    let candidates = cli_discovery::discover_all(&spec, None).await;
    cli_discovery::select_best(&candidates)
        .map(|candidate| candidate.canonical.clone())
        .ok_or_else(|| {
            AppError::NotFound(
                "npm not found; install Node.js/npm to auto-install npm-based language servers"
                    .into(),
            )
        })
}

fn npm_well_known_absolute() -> Vec<&'static str> {
    let mut dirs = HOMEBREW_WELL_KNOWN_ABSOLUTE.to_vec();
    dirs.push("/usr/bin");
    dirs
}

async fn run_npm_install(npm: &Path, dir: &Path, packages: &[&str]) -> Result<(), AppError> {
    let output = Command::new(npm)
        .arg("install")
        .arg("--prefix")
        .arg(dir)
        .args([
            "--no-audit",
            "--no-fund",
            "--ignore-scripts",
            "--no-save",
            "--package-lock=false",
        ])
        .args(packages)
        .env("PATH", path_with_npm_dir(npm))
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("failed to run npm install: {e}")))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(AppError::Internal(format!(
        "npm install failed with status {}: {}\n{}",
        output.status, stderr, stdout
    )))
}

fn path_with_npm_dir(npm: &Path) -> String {
    let existing = std::env::var_os("PATH").unwrap_or_default();
    let Some(parent) = npm.parent() else {
        return existing.to_string_lossy().into_owned();
    };
    let mut paths = vec![parent.to_path_buf()];
    paths.extend(std::env::split_paths(&existing));
    std::env::join_paths(paths)
        .unwrap_or(existing)
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn npm_bin_path_uses_local_node_modules_bin() {
        let root = Path::new("/tmp/cadencr-lsp/typescript-language-server/5.3.0");
        assert_eq!(
            bin_path_for_dir(root, "typescript-language-server"),
            root.join("node_modules")
                .join(".bin")
                .join("typescript-language-server")
        );
    }
}
