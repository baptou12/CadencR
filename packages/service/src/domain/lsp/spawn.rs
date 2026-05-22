//! Spawn an LSP server child process with piped stdio.
//!
//! Resolution flow:
//! 1. Look up the LSP `languageId` in [`catalog::lookup`]. Unknown languages
//!    surface as [`AppError::BadRequest`] so the renderer can show a useful
//!    "no server for this language" message instead of a 500.
//! 2. Walk `cli-discovery` for a `bin_name` on `$PATH` / login-shell PATH /
//!    well-known directories. Pick the highest semver.
//! 3. If discovery finds nothing, fall back to the on-demand-download path
//!    (`~/.cadencr/lsp/<lsp_id>/<version>/<bin_name>`). Step 4 implements
//!    the actual download; step 3 just looks for an already-present binary
//!    so a user who installed manually still works without `$PATH`.
//! 4. Spawn the chosen binary with stdio piped.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::process::{Child, Command};

use crate::error::AppError;

use super::catalog::{self, CatalogEntry, DownloadRecipe};
use super::downloader;

/// What we need to actually invoke a server. Produced by [`resolve_server`].
#[derive(Debug, Clone)]
pub struct ServerSpec {
    /// Absolute path to the binary on disk.
    pub command: PathBuf,
    pub args: Vec<String>,
    /// Human-readable identifier used only in error messages and tracing.
    pub display_name: String,
}

/// Lightweight, sync resolution used by `POST /api/lsp/sessions` to fail fast
/// when the renderer asks for an unsupported language. Does NOT touch the
/// filesystem — full discovery happens later in [`resolve_server`].
pub fn resolve_language(language_id: &str) -> Result<&'static CatalogEntry, AppError> {
    catalog::lookup(language_id).ok_or_else(|| {
        AppError::BadRequest(format!(
            "no language server registered for language id {language_id:?}"
        ))
    })
}

/// Full async resolution: catalog → `cli-discovery` → on-demand-download path.
///
/// Returns `BadRequest` for an unknown language; `NotFound` when we know
/// *what* binary to look for but couldn't find it on disk (renderer surfaces
/// this as "install `<bin_name>` to enable LSP for `<language>`").
pub async fn resolve_server(language_id: &str) -> Result<ServerSpec, AppError> {
    let entry = resolve_language(language_id)?;

    // Step 1: cli-discovery walks PATH + login-shell PATH + well-known dirs.
    let spec = entry.discovery_spec();
    let candidates = cli_discovery::discover_all(&spec, None).await;
    if let Some(best) = cli_discovery::select_best(&candidates) {
        return Ok(ServerSpec {
            command: best.canonical.clone(),
            args: entry.args.iter().map(|s| s.to_string()).collect(),
            display_name: entry.lsp_id.to_string(),
        });
    }

    // Step 2: managed install at ~/.cadencr/lsp/<lsp_id>/<version>/<bin>.
    // For entries without a download recipe this just checks an explicit
    // user-installed path; with a recipe, step 4's downloader actually
    // fetches the binary the first time.
    if let Some(managed) = ensure_managed_binary(entry).await? {
        return Ok(ServerSpec {
            command: managed,
            args: entry.args.iter().map(|s| s.to_string()).collect(),
            display_name: entry.lsp_id.to_string(),
        });
    }

    Err(AppError::NotFound(format!(
        "language server {bin:?} not found for {lang:?}; install it on $PATH \
         (looked under common install dirs as well)",
        bin = entry.bin_name,
        lang = language_id,
    )))
}

/// Resolve the managed-install path for a catalog entry. Triggers the
/// downloader if the entry has a recipe and the binary isn't already
/// present. Returns `Ok(None)` when there's no recipe and no pre-existing
/// binary — caller surfaces that as `NotFound`.
async fn ensure_managed_binary(entry: &CatalogEntry) -> Result<Option<PathBuf>, AppError> {
    let recipe = match &entry.download {
        Some(r) => r,
        None => return Ok(None),
    };
    let DownloadRecipe::GithubReleaseGz { version, .. } = recipe;
    let bin_path = downloader::install_dir(entry.lsp_id, version)?.join(entry.bin_name);
    if bin_path.exists() {
        return Ok(Some(bin_path));
    }
    downloader::download_and_install(entry, recipe).await?;
    Ok(Some(bin_path))
}

/// Spawns the configured server with stdio piped. The caller takes ownership
/// of stdin/stdout/stderr and drives them; we set `kill_on_drop` so a panicked
/// proxy task does not leak a zombie language server.
pub fn spawn_server(spec: &ServerSpec, workspace_root: &Path) -> Result<Child, AppError> {
    Command::new(&spec.command)
        .args(&spec.args)
        .current_dir(workspace_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| AppError::Internal(format!("failed to spawn {}: {e}", spec.display_name)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typescript_family_resolves_synchronously() {
        for lang in [
            "typescript",
            "typescriptreact",
            "javascript",
            "javascriptreact",
        ] {
            let entry = resolve_language(lang).expect(lang);
            assert_eq!(entry.bin_name, "typescript-language-server");
        }
    }

    #[test]
    fn rust_resolves_to_rust_analyzer_via_catalog() {
        let entry = resolve_language("rust").expect("rust");
        assert_eq!(entry.bin_name, "rust-analyzer");
    }

    #[test]
    fn unknown_language_is_bad_request() {
        let err = resolve_language("brainfuck").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }
}
