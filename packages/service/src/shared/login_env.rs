//! Hydrate the process env from the user's login shell.
//!
//! When Cadencr is launched from a GUI (Finder, Spotlight, dock icon, Electron
//! sidecar), it inherits the **launchd** environment — a minimal `PATH` of
//! `/usr/bin:/bin:/usr/sbin:/sbin`, no `GPG_TTY`, no `SSH_AUTH_SOCK`, no
//! `GNUPGHOME`, no Homebrew prefix on `PATH`. The same `git commit` that
//! signs cleanly in Terminal then fails inside the app: `gpg` isn't on the
//! `PATH`, or it is but can't reach the agent socket the user's login shell
//! exported.
//!
//! The fix is the same trick GitHub Desktop, VS Code, Atom, and the npm
//! `shell-env` package all use: spawn the user's login shell once at
//! startup, ask it for its env, and merge the result into our process env.
//! Subsequent `Command::new("git")` calls (and the portable-pty PTY commands
//! we explicitly inherit env for) then see the same `PATH`/`GPG_*`/`SSH_*`
//! the user sees in Terminal.
//!
//! Scope:
//! - macOS only by default (the Linux/Windows GUI launcher problem is
//!   different and rarely shows up in practice).
//! - Skipped if `CADENCR_SKIP_LOGIN_ENV=1` (escape hatch for tests / CI /
//!   users who want the launchd env verbatim).
//! - Best-effort: any failure (missing `$SHELL`, non-zero exit, parse
//!   error, 2-second timeout) logs a warning and returns. We never block
//!   startup on this.

use std::collections::HashSet;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::timeout;

/// Vars whose values must come from the login shell, even if launchd
/// already exported a (worse) value. `PATH` is the canonical case: launchd
/// hands us `/usr/bin:/bin:/usr/sbin:/sbin`, the login shell hands us the
/// user's real path including Homebrew, asdf, mise, etc.
const ALWAYS_OVERRIDE: &[&str] = &[
    "PATH",
    "MANPATH",
    "INFOPATH",
    "GPG_TTY",
    "GNUPGHOME",
    "SSH_AUTH_SOCK",
    "SSH_AGENT_PID",
    "GPG_AGENT_INFO",
    "PINENTRY_USER_DATA",
    "HOMEBREW_PREFIX",
    "HOMEBREW_CELLAR",
    "HOMEBREW_REPOSITORY",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
];

/// Vars we never copy from the login shell. Three reasons something lands
/// here:
///   1. Cadencr-owned state set by the launcher / dotenv before we run
///      (`CADENCR_*`).
///   2. Shell bookkeeping that's wrong for a long-running daemon (`PWD`,
///      `OLDPWD`, `SHLVL`, `_`, `XPC_SERVICE_NAME`).
///   3. **Dyld / ld.so code-injection vectors.** macOS hardened-runtime
///      strips these at exec time anyway, but in dev / unsigned builds
///      they'd otherwise propagate from a user's shell straight into our
///      subprocesses. Defense-in-depth: the cost is five `matches!` arms.
///
/// We also reject anything that doesn't look like a POSIX env var name
/// (`[A-Za-z_][A-Za-z0-9_]*`). `env -0` itself never emits malformed
/// records, but if a user's rc file `echo`s noise to stdout before our
/// `env -0` runs, that noise gets glued onto the first record's key and
/// we'd otherwise set a junk variable.
fn is_blocked(key: &str) -> bool {
    if key.is_empty() {
        return true;
    }
    if matches!(
        key,
        "PWD"
            | "OLDPWD"
            | "SHLVL"
            | "_"
            | "TMPDIR_SECRET"
            | "XPC_SERVICE_NAME"
            | "DYLD_INSERT_LIBRARIES"
            | "DYLD_LIBRARY_PATH"
            | "DYLD_FALLBACK_LIBRARY_PATH"
            | "DYLD_FRAMEWORK_PATH"
            | "DYLD_FALLBACK_FRAMEWORK_PATH"
            | "LD_PRELOAD"
            | "LD_LIBRARY_PATH"
            | "LD_AUDIT"
    ) {
        return true;
    }
    if key.starts_with("CADENCR_") {
        return true;
    }
    if !is_valid_env_name(key) {
        return true;
    }
    false
}

/// POSIX-ish env var name check: first char `[A-Za-z_]`, rest
/// `[A-Za-z0-9_]`. Cheap and avoids pulling in a regex dep.
fn is_valid_env_name(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Run the user's login shell, parse its env, and merge into our process.
/// Logs at info on success, warns on failure — never panics. Returns the
/// number of vars actually written (for tests / diagnostics).
pub async fn hydrate_from_login_shell() -> usize {
    if std::env::var("CADENCR_SKIP_LOGIN_ENV").is_ok_and(|v| v == "1") {
        tracing::info!("login-shell env hydration skipped (CADENCR_SKIP_LOGIN_ENV=1)");
        return 0;
    }

    // Linux/Windows GUI launchers don't reproduce the macOS launchd vs
    // login-shell split nearly as often. Restrict to macOS for now; if we
    // ever ship a Linux desktop build with a similar bug we can lift this.
    if !cfg!(target_os = "macos") {
        return 0;
    }

    let shell = match std::env::var("SHELL") {
        Ok(s) if !s.is_empty() => s,
        _ => {
            tracing::warn!("$SHELL not set; falling back to /bin/zsh for env hydration");
            "/bin/zsh".to_string()
        }
    };

    let raw = match capture_login_shell_env(&shell).await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("login-shell env hydration failed: {e}; continuing with launchd env");
            return 0;
        }
    };

    let parsed = parse_env_null_separated(&raw);
    apply_env(parsed)
}

/// Spawn `$SHELL -ilc 'env -0'` and capture stdout. The `-0` makes `env`
/// emit NUL-terminated KEY=VALUE records, which lets us parse multi-line
/// values (e.g. functions exported by `direnv`, ASCII-art `MOTD` strings)
/// without the line-splitting fragility of plain `env`.
///
/// `-i` (interactive) is required so the shell sources rc files like
/// `.zshrc` / `.bashrc` where most users actually export `GPG_TTY` and
/// shim their `PATH`. `-l` (login) covers `.zprofile` / `.bash_profile`,
/// where the system-wide `path_helper` is invoked on macOS.
async fn capture_login_shell_env(shell: &str) -> Result<String, String> {
    let mut child = Command::new(shell)
        .arg("-ilc")
        .arg("env -0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn {shell}: {e}"))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "child stdout missing".to_string())?;

    // 2 s is generous; an interactive zsh with heavy plugins (powerlevel10k,
    // nvm) typically completes in well under 500 ms. If a user's rc files
    // genuinely take longer than that we'd rather start with the launchd
    // env than block the UI.
    let read = async {
        let mut buf = Vec::with_capacity(8 * 1024);
        stdout
            .read_to_end(&mut buf)
            .await
            .map_err(|e| format!("read stdout: {e}"))?;
        Ok::<_, String>(String::from_utf8_lossy(&buf).into_owned())
    };

    let raw = match timeout(Duration::from_secs(2), read).await {
        Ok(Ok(raw)) => raw,
        Ok(Err(e)) => return Err(e),
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err("shell hydration timed out after 2s".to_string());
        }
    };

    // Reap the child so it doesn't show up as a zombie. Ignore the status:
    // an interactive shell can legitimately exit non-zero from rc-file
    // glitches and still have produced a valid env dump.
    let _ = timeout(Duration::from_millis(500), child.wait()).await;

    Ok(raw)
}

/// Parse the NUL-terminated `KEY=VALUE` records produced by `env -0`.
/// Returns `(key, value)` pairs in input order. Records without an `=`
/// are skipped (shouldn't happen in practice but cheap to defend against).
fn parse_env_null_separated(raw: &str) -> Vec<(String, String)> {
    raw.split('\0')
        .filter(|r| !r.is_empty())
        .filter_map(|record| {
            let (k, v) = record.split_once('=')?;
            Some((k.to_string(), v.to_string()))
        })
        .collect()
}

/// Merge `pairs` into the process env. `ALWAYS_OVERRIDE` keys win over
/// whatever launchd handed us; everything else is set only if currently
/// unset (so e.g. an explicitly-set `RUST_LOG` from the dev `.env` is
/// respected). Returns the number of vars actually written.
fn apply_env(pairs: Vec<(String, String)>) -> usize {
    let always: HashSet<&str> = ALWAYS_OVERRIDE.iter().copied().collect();
    let mut written = 0;
    for (key, value) in pairs {
        if is_blocked(&key) {
            continue;
        }
        let should_write = always.contains(key.as_str()) || std::env::var_os(&key).is_none();
        if !should_write {
            continue;
        }
        // SAFETY: `set_var` is unsafe in edition 2024 because it races with
        // concurrent reads. We only call this from `main` before any
        // worker tasks read env vars, so the race window doesn't open.
        std::env::set_var(&key, &value);
        written += 1;
    }
    if written > 0 {
        tracing::info!("hydrated {written} env vars from login shell");
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn parses_null_separated_records() {
        let raw = "FOO=bar\0BAZ=qux=more\0EMPTY=\0";
        let parsed = parse_env_null_separated(raw);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0], ("FOO".into(), "bar".into()));
        assert_eq!(parsed[1], ("BAZ".into(), "qux=more".into()));
        assert_eq!(parsed[2], ("EMPTY".into(), "".into()));
    }

    #[test]
    fn parser_skips_records_without_equals() {
        let parsed = parse_env_null_separated("ORPHAN\0KEY=val\0");
        assert_eq!(parsed, vec![("KEY".into(), "val".into())]);
    }

    #[test]
    fn parser_handles_multiline_values() {
        // `env -0` emits NUL between records, so newlines inside a value
        // (e.g. an exported shell function) survive intact.
        let raw = "FN=line1\nline2\nline3\0NEXT=ok\0";
        let parsed = parse_env_null_separated(raw);
        assert_eq!(parsed[0].1, "line1\nline2\nline3");
        assert_eq!(parsed[1], ("NEXT".into(), "ok".into()));
    }

    #[test]
    fn blocks_cadencr_and_shell_bookkeeping() {
        assert!(is_blocked("PWD"));
        assert!(is_blocked("OLDPWD"));
        assert!(is_blocked("SHLVL"));
        assert!(is_blocked("_"));
        assert!(is_blocked("CADENCR_DB_PATH"));
        assert!(is_blocked("CADENCR_AUTH_TOKEN"));
        assert!(!is_blocked("PATH"));
        assert!(!is_blocked("GPG_TTY"));
        assert!(!is_blocked("HOME"));
    }

    #[test]
    fn blocks_dyld_and_ldso_injection_vectors() {
        // Defense-in-depth: hardened-runtime macOS strips these at exec,
        // but dev / unsigned builds would otherwise inherit a user's shell
        // value and propagate it into every subprocess we spawn.
        assert!(is_blocked("DYLD_INSERT_LIBRARIES"));
        assert!(is_blocked("DYLD_LIBRARY_PATH"));
        assert!(is_blocked("DYLD_FALLBACK_LIBRARY_PATH"));
        assert!(is_blocked("DYLD_FRAMEWORK_PATH"));
        assert!(is_blocked("DYLD_FALLBACK_FRAMEWORK_PATH"));
        assert!(is_blocked("LD_PRELOAD"));
        assert!(is_blocked("LD_LIBRARY_PATH"));
        assert!(is_blocked("LD_AUDIT"));
    }

    #[test]
    fn blocks_malformed_env_names() {
        // If a user's rc file `echo`s noise to stdout before our `env -0`
        // runs, that noise gets glued onto the first record's key. Reject.
        assert!(is_blocked(""));
        assert!(is_blocked("hi\nKEY"));
        assert!(is_blocked("1STARTSWITHDIGIT"));
        assert!(is_blocked("HAS SPACE"));
        assert!(is_blocked("HAS-DASH"));
        assert!(is_blocked("HAS.DOT"));
        // Sanity: well-formed names still pass.
        assert!(!is_blocked("PATH"));
        assert!(!is_blocked("_LEADING_UNDERSCORE"));
        assert!(!is_blocked("MIXED_123_CASE_ok"));
    }

    #[test]
    fn validates_posix_env_names() {
        assert!(is_valid_env_name("PATH"));
        assert!(is_valid_env_name("_X"));
        assert!(is_valid_env_name("A1"));
        assert!(!is_valid_env_name(""));
        assert!(!is_valid_env_name("1A"));
        assert!(!is_valid_env_name("A B"));
        assert!(!is_valid_env_name("A=B"));
    }

    /// Single test mutating real env vars — kept serial via the unique key.
    /// Verifies the override / fill-if-missing / blocked policy on one go.
    #[test]
    fn apply_env_respects_override_and_blocklist() {
        let _guard = env_lock().lock().unwrap();
        // Use unique-suffix keys so we can't collide with anything the
        // host environment or other tests might have set.
        let always = "PATH"; // genuinely in ALWAYS_OVERRIDE
        let fill_only = "CADENCR_LOGIN_ENV_TEST_FILL_42";
        let blocked = "CADENCR_LOGIN_ENV_TEST_BLOCKED_42";

        let prev_path = std::env::var(always).ok();
        std::env::set_var(always, "/launchd/only");
        std::env::set_var(fill_only, "preexisting");
        std::env::remove_var(blocked);

        let pairs = vec![
            (always.into(), "/from/login".into()),
            (fill_only.into(), "from-login".into()),
            (blocked.into(), "should-not-appear".into()),
        ];
        apply_env(pairs);

        assert_eq!(std::env::var(always).unwrap(), "/from/login");
        // Pre-existing non-override key keeps its value.
        assert_eq!(std::env::var(fill_only).unwrap(), "preexisting");
        // Blocked key never written.
        assert!(std::env::var(blocked).is_err());

        // Best-effort cleanup.
        std::env::remove_var(fill_only);
        if let Some(v) = prev_path {
            std::env::set_var(always, v);
        } else {
            std::env::remove_var(always);
        }
    }
}
