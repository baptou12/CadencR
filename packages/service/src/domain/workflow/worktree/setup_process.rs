//! Terminal-backed setup command execution.
//!
//! Worktree setup is user-authored shell code, so it must run like the shell a
//! user opens in the app terminal: login + interactive startup, attached to a
//! real PTY. That is what makes rc-file Node manager initialization (`nvm`,
//! `fnm`, `mise`, `asdf`, Corepack shims, etc.) available without hardcoding
//! any one user's setup.

use std::io::Read;
use std::path::Path;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::sync::mpsc::Sender;

const OUTPUT_CHANNEL_CAPACITY: usize = 256;
const MAX_PENDING_OUTPUT_BYTES: usize = 16 * 1024;

struct ShellInvocation {
    program: String,
    args: Vec<&'static str>,
}

/// Run a setup script inside an interactive login shell attached to a PTY.
///
/// Output is merged exactly like a terminal and sent as display lines while the
/// process runs. The caller owns persistence/WebSocket fanout so this low-level
/// helper stays reusable and easy to test via `run_setup_commands`.
pub async fn run_terminal_setup_script(
    script: &str,
    cwd: &Path,
    output_tx: Sender<String>,
) -> Result<(), String> {
    let shell = shell_invocation();
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open setup terminal: {e}"))?;

    let mut cmd = CommandBuilder::new(&shell.program);
    inherit_env(&mut cmd);
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("FORCE_COLOR", "1");
    for arg in &shell.args {
        cmd.arg(arg);
    }
    cmd.arg(script);

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn setup shell `{}`: {e}", shell.program))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to read setup terminal output: {e}"))?;
    let read_handle = tokio::task::spawn_blocking(move || read_pty_lines(&mut reader, output_tx));

    let wait_result = tokio::task::spawn_blocking(move || child.wait()).await;
    let status = wait_result
        .map_err(|e| format!("Setup shell wait task panicked: {e}"))?
        .map_err(|e| format!("Failed to wait on setup shell: {e}"))?;
    read_handle
        .await
        .map_err(|e| format!("Setup output reader task panicked: {e}"))?;
    drop(pair.master);

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Setup script exited with status {status} (shell: {}, cwd: {}, PATH: {})",
            shell.command_label(),
            cwd.display(),
            std::env::var("PATH").unwrap_or_else(|_| "<unset>".to_string())
        ))
    }
}

fn shell_invocation() -> ShellInvocation {
    match std::env::var("SHELL") {
        Ok(shell) if !shell.trim().is_empty() => ShellInvocation {
            program: shell,
            args: vec!["-l", "-i", "-c"],
        },
        _ => ShellInvocation {
            program: "/bin/sh".to_string(),
            args: vec!["-i", "-c"],
        },
    }
}

impl ShellInvocation {
    fn command_label(&self) -> String {
        format!("{} {}", self.program, self.args.join(" "))
    }
}

fn inherit_env(cmd: &mut CommandBuilder) {
    for (key, value) in std::env::vars_os() {
        cmd.env(key, value);
    }
}

fn read_pty_lines(reader: &mut dyn Read, output_tx: Sender<String>) {
    let mut buf = [0_u8; 4096];
    let mut pending = String::new();
    loop {
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        pending.push_str(&String::from_utf8_lossy(&buf[..n]));
        flush_complete_segments(&mut pending, &output_tx);
        flush_oversized_pending(&mut pending, &output_tx);
    }
    if !pending.is_empty() {
        let line = pending.trim_end_matches('\r').to_string();
        let _ = output_tx.blocking_send(line);
    }
}

fn flush_complete_segments(pending: &mut String, output_tx: &Sender<String>) {
    while let Some(index) = pending.find(['\n', '\r']) {
        let mut line = pending.drain(..=index).collect::<String>();
        if line.ends_with('\n') || line.ends_with('\r') {
            line.pop();
        }
        let _ = output_tx.blocking_send(line);
    }
}

fn flush_oversized_pending(pending: &mut String, output_tx: &Sender<String>) {
    if pending.len() <= MAX_PENDING_OUTPUT_BYTES {
        return;
    }
    let line = std::mem::take(pending);
    let _ = output_tx.blocking_send(line);
}

pub fn setup_output_channel() -> (Sender<String>, tokio::sync::mpsc::Receiver<String>) {
    tokio::sync::mpsc::channel(OUTPUT_CHANNEL_CAPACITY)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::test_env::{env_lock, EnvVarGuard};

    #[test]
    fn shell_invocation_uses_interactive_login_user_shell() {
        let _guard = env_lock().lock().expect("env lock");
        let _shell = EnvVarGuard::set("SHELL", "/bin/zsh");

        let invocation = shell_invocation();

        assert_eq!(invocation.program, "/bin/zsh");
        assert_eq!(invocation.args, vec!["-l", "-i", "-c"]);
    }

    #[test]
    fn shell_invocation_omits_login_flag_for_empty_shell_fallback() {
        let _guard = env_lock().lock().expect("env lock");
        let _shell = EnvVarGuard::set("SHELL", "");

        let invocation = shell_invocation();

        assert_eq!(invocation.program, "/bin/sh");
        assert_eq!(invocation.args, vec!["-i", "-c"]);
    }
}
