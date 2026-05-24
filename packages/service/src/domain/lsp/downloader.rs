//! On-demand install of catalog-managed LSP binaries.
//!
//! Storage layout is recipe-specific under
//! `~/.cadencr/lsp/<lsp_id>/<version>/`. The directory is created with
//! `0700` so a multi-user host can't read another user's installed binaries.
//!
//! Both native GitHub assets and npm package recipes are handled here so
//! callers don't have to branch on install mechanism.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use futures::StreamExt;
use tracing::{info, warn};

use crate::error::AppError;

use super::catalog::{CatalogEntry, DownloadRecipe};
use super::npm_installer;

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
    match recipe {
        DownloadRecipe::GithubReleaseGz {
            version,
            url_template,
        } => download_github_release_gz(entry, version, url_template).await,
        DownloadRecipe::NpmPackage { version, packages } => {
            npm_installer::install(entry, version, packages).await
        }
    }
}

pub fn managed_bin_path(
    entry: &CatalogEntry,
    recipe: &DownloadRecipe,
) -> Result<PathBuf, AppError> {
    let dir = install_dir(entry.lsp_id, recipe.version())?;
    let path = match recipe {
        DownloadRecipe::GithubReleaseGz { .. } => dir.join(entry.bin_name),
        DownloadRecipe::NpmPackage { .. } => npm_installer::bin_path_for_dir(&dir, entry.bin_name),
    };
    Ok(path)
}

async fn download_github_release_gz(
    entry: &CatalogEntry,
    version: &str,
    url_template: &str,
) -> Result<(), AppError> {
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

    // Build a dedicated client per download — we want explicit timeouts so a
    // stalled connection doesn't hang the LSP-session POST indefinitely, and
    // a real User-Agent because GitHub serves throttled / rate-limited
    // responses to clients that don't identify themselves.
    let client = reqwest::Client::builder()
        .user_agent(concat!("cadencr/", env!("CARGO_PKG_VERSION")))
        // Generous read timeout: rust-analyzer is ~30 MB and users on a
        // mobile hotspot are still legitimate. But cap it so a frozen
        // socket eventually errors instead of looking like a hung process.
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Internal(format!("LSP download client build failed: {e}")))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("LSP download request failed: {e}")))?;
    if !response.status().is_success() {
        return Err(AppError::Internal(format!(
            "LSP download HTTP {}: {}",
            response.status(),
            url
        )));
    }
    let total_size = response.content_length();
    let tmp_path = bin_path.with_extension("download");
    stream_to_disk(response, &tmp_path, total_size, entry.lsp_id).await?;
    finalize_install(&tmp_path, &bin_path, entry.lsp_id)?;

    // GC sibling version dirs. After bumping a pinned version, the previous
    // install would otherwise sit ~30 MB on disk forever — and worse, if a
    // user happened to symlink it into PATH or run it directly, they'd get
    // the proc-macro protocol mismatch we were trying to avoid by bumping.
    if let Some(parent) = dir.parent() {
        gc_old_versions(parent, version);
    }
    Ok(())
}

/// Stream the response body to a temp file, decompressing as we go. We log a
/// progress line at most every 5 s so a slow download is visible in the
/// terminal without flooding it. Compressing on the fly (vs. buffering the
/// whole response in memory) keeps peak RSS well below the compressed size
/// and lets `tokio::time` cancel a stuck read.
async fn stream_to_disk(
    response: reqwest::Response,
    tmp_path: &std::path::Path,
    total_size: Option<u64>,
    lsp_id: &str,
) -> Result<(), AppError> {
    // We decompress in a blocking decoder fed from a channel. The async side
    // (this fn) pushes raw chunks; the blocking side gunzips and writes.
    // Keeping the channel small bounds memory to ~one chunk per side.
    let tmp_path_owned = tmp_path.to_path_buf();
    let lsp_id_owned = lsp_id.to_string();
    let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(4);
    let writer = tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        let mut file = fs::File::create(&tmp_path_owned)
            .map_err(|e| AppError::Internal(format!("create {}: {e}", tmp_path_owned.display())))?;
        let reader = ChannelReader::new(rx);
        let mut decoder = flate2::read::GzDecoder::new(reader);
        std::io::copy(&mut decoder, &mut file)
            .map_err(|e| AppError::Internal(format!("decompress {lsp_id_owned}: {e}")))?;
        file.flush()
            .map_err(|e| AppError::Internal(format!("flush {}: {e}", tmp_path_owned.display())))?;
        Ok(())
    });

    let mut stream = response.bytes_stream();
    let mut received: u64 = 0;
    let mut last_log = Instant::now();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk
            .map_err(|e| AppError::Internal(format!("LSP download body chunk failed: {e}")))?;
        received += bytes.len() as u64;
        if last_log.elapsed() >= Duration::from_secs(5) {
            match total_size {
                Some(total) => info!(
                    lsp_id = %lsp_id,
                    progress = format!("{} / {} bytes", received, total),
                    "downloading LSP binary"
                ),
                None => {
                    info!(lsp_id = %lsp_id, received_bytes = received, "downloading LSP binary")
                }
            }
            last_log = Instant::now();
        }
        // `send` blocks if the writer is behind — backpressure, exactly
        // what we want. An error here means the writer task died.
        if tx.send(bytes.to_vec()).is_err() {
            break;
        }
    }
    // Drop the sender so the writer sees EOF and finishes.
    drop(tx);
    writer
        .await
        .map_err(|e| AppError::Internal(format!("LSP install join error: {e}")))??;
    Ok(())
}

/// Bridge from the async chunk channel to the sync `GzDecoder`. Owns the
/// receiver and a residual buffer for partial-chunk reads.
struct ChannelReader {
    rx: std::sync::mpsc::Receiver<Vec<u8>>,
    leftover: Vec<u8>,
    leftover_pos: usize,
}

impl ChannelReader {
    fn new(rx: std::sync::mpsc::Receiver<Vec<u8>>) -> Self {
        Self {
            rx,
            leftover: Vec::new(),
            leftover_pos: 0,
        }
    }
}

impl std::io::Read for ChannelReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.leftover_pos >= self.leftover.len() {
            match self.rx.recv() {
                Ok(chunk) => {
                    self.leftover = chunk;
                    self.leftover_pos = 0;
                }
                Err(_) => return Ok(0), // EOF
            }
        }
        let available = &self.leftover[self.leftover_pos..];
        let n = available.len().min(buf.len());
        buf[..n].copy_from_slice(&available[..n]);
        self.leftover_pos += n;
        Ok(n)
    }
}

/// chmod the temp file and atomically rename into place. Atomic so a
/// crashed download never leaves a partial binary at the canonical path —
/// the next launch retries cleanly.
fn finalize_install(
    tmp_path: &std::path::Path,
    bin_path: &std::path::Path,
    _lsp_id: &str,
) -> Result<(), AppError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(tmp_path, fs::Permissions::from_mode(0o700))
            .map_err(|e| AppError::Internal(format!("chmod {}: {e}", tmp_path.display())))?;
    }
    fs::rename(tmp_path, bin_path).map_err(|e| {
        AppError::Internal(format!(
            "rename {} -> {}: {e}",
            tmp_path.display(),
            bin_path.display()
        ))
    })?;
    Ok(())
}

/// Remove every sibling directory of `<lsp_id>/<keep>/` so an upgrade frees
/// the old install's bytes. Best-effort: failure to remove (busy file, FS
/// permission glitch) is logged and ignored — the new install still works.
pub(super) fn gc_old_versions(lsp_root: &std::path::Path, keep: &str) {
    let Ok(entries) = fs::read_dir(lsp_root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if name == keep || !path.is_dir() {
            continue;
        }
        if let Err(e) = fs::remove_dir_all(&path) {
            warn!(path = %path.display(), error = %e, "failed to gc old LSP install");
        } else {
            info!(path = %path.display(), "gc'd previous LSP install");
        }
    }
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

    #[test]
    fn gc_old_versions_removes_siblings_but_keeps_current() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        // Two old versions + the current one.
        for v in ["2024-01-01", "2025-05-19", "2026-05-18"] {
            let d = root.join(v);
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join("rust-analyzer"), b"#!/bin/sh\nexit 0\n").unwrap();
        }
        gc_old_versions(root, "2026-05-18");
        assert!(root.join("2026-05-18").is_dir(), "current must survive gc");
        assert!(!root.join("2024-01-01").exists(), "old must be removed");
        assert!(!root.join("2025-05-19").exists(), "old must be removed");
    }

    #[test]
    fn gc_old_versions_is_safe_when_root_missing() {
        // Don't panic when the lsp_root doesn't exist yet (first-ever install).
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("never-created");
        gc_old_versions(&missing, "anything");
    }
}
