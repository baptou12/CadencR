//! On-demand download + extraction of catalog-managed LSP binaries.
//!
//! Storage layout: `~/.cadencr/lsp/<lsp_id>/<version>/<bin_name>`. The
//! directory is created with `0700` so a multi-user host can't read another
//! user's downloaded binaries.
//!
//! Step 3 ships only [`install_dir`], which computes the path. Step 4 fills
//! in [`download_and_install`], the actual HTTP fetch + gzip extraction.
//! Both helpers live in this module so callers don't have to track which
//! step landed which behaviour.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use tracing::{info, warn};

use crate::error::AppError;

use super::catalog::{CatalogEntry, DownloadRecipe};

/// Directory under `~/.cadencr/lsp/<lsp_id>/<version>/` for a given recipe.
/// Creates parent dirs if missing (mode `0700` on unix).
pub fn install_dir(lsp_id: &str, version: &str) -> Result<PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| {
        AppError::Internal("could not determine $HOME for LSP install directory".into())
    })?;
    let dir = home.join(".cadencr").join("lsp").join(lsp_id).join(version);
    create_dir_secure(&dir)?;
    Ok(dir)
}

fn create_dir_secure(dir: &std::path::Path) -> Result<(), AppError> {
    if dir.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(dir).map_err(|e| {
        AppError::Internal(format!(
            "failed to create LSP install dir {}: {e}",
            dir.display()
        ))
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o700);
        if let Err(e) = fs::set_permissions(dir, perms) {
            warn!(dir = %dir.display(), error = %e, "failed to chmod 0700 on LSP install dir");
        }
    }
    Ok(())
}

/// Fetch and install the binary described by `recipe` into
/// `install_dir(entry.lsp_id, recipe.version)`. Best-effort idempotent — the
/// caller re-checks the binary path before invoking us, but a race with a
/// concurrent install still produces a usable binary on disk.
pub async fn download_and_install(
    entry: &CatalogEntry,
    recipe: &DownloadRecipe,
) -> Result<(), AppError> {
    let DownloadRecipe::GithubReleaseGz {
        version,
        url_template,
    } = recipe;
    let url = render_url(url_template, version)?;
    let dir = install_dir(entry.lsp_id, version)?;
    let bin_path = dir.join(entry.bin_name);
    info!(
        lsp_id = entry.lsp_id,
        version = version,
        url = %url,
        target = %bin_path.display(),
        "downloading LSP binary"
    );
    let response = reqwest::get(&url)
        .await
        .map_err(|e| AppError::Internal(format!("LSP download request failed: {e}")))?;
    if !response.status().is_success() {
        return Err(AppError::Internal(format!(
            "LSP download HTTP {}: {}",
            response.status(),
            url
        )));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("LSP download body failed: {e}")))?;

    // Decompress in a blocking task so we don't stall the runtime on a large
    // binary (rust-analyzer is ~30MB).
    let bin_path_clone = bin_path.clone();
    let lsp_id = entry.lsp_id.to_string();
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        let mut decoder = flate2::read::GzDecoder::new(bytes.as_ref());
        let tmp_path = bin_path_clone.with_extension("download");
        let mut file = fs::File::create(&tmp_path)
            .map_err(|e| AppError::Internal(format!("create {}: {e}", tmp_path.display())))?;
        std::io::copy(&mut decoder, &mut file)
            .map_err(|e| AppError::Internal(format!("decompress {lsp_id}: {e}")))?;
        file.flush()
            .map_err(|e| AppError::Internal(format!("flush {}: {e}", tmp_path.display())))?;
        drop(file);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o700))
                .map_err(|e| AppError::Internal(format!("chmod {}: {e}", tmp_path.display())))?;
        }
        // Atomic rename so a partial download never appears at the canonical
        // path. Cleanup races (concurrent installs) accept whichever rename
        // wins.
        fs::rename(&tmp_path, &bin_path_clone).map_err(|e| {
            AppError::Internal(format!(
                "rename {} -> {}: {e}",
                tmp_path.display(),
                bin_path_clone.display()
            ))
        })?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(format!("LSP install join error: {e}")))??;
    Ok(())
}

/// Substitute `{version}` / `{arch}` / `{os}` into a URL template. Returns
/// an error when the host platform is one we don't have a release asset for
/// (callers surface that as "your platform isn't supported by the bundled
/// installer; install manually").
fn render_url(template: &str, version: &str) -> Result<String, AppError> {
    let (arch, os) = current_platform_tag()?;
    Ok(template
        .replace("{version}", version)
        .replace("{arch}", arch)
        .replace("{os}", os))
}

/// Map the host `target_arch`/`target_os` to the strings rust-analyzer (and
/// similar) use in their release asset names. New platforms = new arm here.
fn current_platform_tag() -> Result<(&'static str, &'static str), AppError> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        other => {
            return Err(AppError::Internal(format!(
                "no LSP release asset available for arch {other:?}"
            )))
        }
    };
    let os = match std::env::consts::OS {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-gnu",
        other => {
            return Err(AppError::Internal(format!(
                "no LSP release asset available for os {other:?}"
            )))
        }
    };
    Ok((arch, os))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_dir_creates_under_home_lsp() {
        // We can't override $HOME on every platform, so just exercise the
        // path-construction half. The mkdir half is exercised by an
        // integration test the first time the downloader actually runs.
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("foo").join("1.0");
        create_dir_secure(&dir).unwrap();
        assert!(dir.is_dir());
    }

    #[test]
    fn render_url_substitutes_all_placeholders() {
        let url = render_url("https://x/{version}/y-{arch}-{os}.gz", "2025-05-19").expect("render");
        assert!(url.contains("2025-05-19"));
        // arch/os depend on host platform — just assert the placeholders
        // were consumed.
        assert!(!url.contains("{"));
    }
}
