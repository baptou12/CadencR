//! Spawn an LSP server child process with piped stdio.
//!
//! Step 1 hardcodes `typescript-language-server --stdio` so we can prove the
//! WebSocket ↔ stdio round-trip without committing to a catalog format.
//! Step 3 replaces [`resolve_server`] with a data-driven catalog lookup;
//! step 4 adds the on-demand downloader. The rest of this file stays
//! language-agnostic — it deals in [`ServerSpec`] values, never in `match
//! language { "rust" => ..., "typescript" => ... }` branches (forbidden by
//! `.claude/rules/provider-boundaries.md`).

use std::path::Path;
use std::process::Stdio;

use tokio::process::{Child, Command};

use crate::error::AppError;

/// What we need to actually invoke a server. Produced today by the hardcoded
/// fallback below; produced tomorrow by the catalog + `cli-discovery` lookup.
#[derive(Debug, Clone)]
pub struct ServerSpec {
    /// Absolute path or PATH-resolvable binary name.
    pub command: String,
    pub args: Vec<String>,
    /// Human-readable identifier used only in error messages and tracing.
    pub display_name: &'static str,
}

/// Resolves a language id to an invocation spec.
///
/// Step 1 stub: only `typescript`/`typescriptreact`/`javascript`/`javascriptreact`
/// resolve, and only via the binary on `$PATH`. Anything else returns
/// [`AppError::BadRequest`] so the renderer can surface "no server for this
/// language" to the user without a 500.
pub fn resolve_server(language_id: &str) -> Result<ServerSpec, AppError> {
    match language_id {
        "typescript" | "typescriptreact" | "javascript" | "javascriptreact" => Ok(ServerSpec {
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            display_name: "typescript-language-server",
        }),
        other => Err(AppError::BadRequest(format!(
            "no language server registered for language id {other:?} (step 1 spike only \
             supports typescript family; full catalog lands in step 3)"
        ))),
    }
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
        .map_err(|e| {
            AppError::Internal(format!(
                "failed to spawn {bin}: {e}",
                bin = spec.display_name
            ))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typescript_family_resolves() {
        for lang in [
            "typescript",
            "typescriptreact",
            "javascript",
            "javascriptreact",
        ] {
            let spec = resolve_server(lang).expect(lang);
            assert_eq!(spec.command, "typescript-language-server");
            assert_eq!(spec.args, vec!["--stdio"]);
        }
    }

    #[test]
    fn unknown_language_is_bad_request() {
        let err = resolve_server("brainfuck").unwrap_err();
        matches!(err, AppError::BadRequest(_));
    }
}
