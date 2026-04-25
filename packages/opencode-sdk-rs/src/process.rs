use std::path::PathBuf;
use std::process::Stdio;
use std::sync::RwLock;
use std::time::Duration;

use cli_discovery::DiscoverySpec;
use once_cell::sync::Lazy;
use regex_lite::Regex;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};
use tokio::time::sleep;
use tracing::{info, warn};

use crate::client::OpenCodeClient;
use crate::error::SdkError;

/// Provider-neutral spec for finding the `opencode` binary.
///
/// Exposed publicly so the host app can call `cli_discovery::discover_all`
/// directly to render an onboarding "pick a binary" UI without re-declaring
/// the well-known install dirs here.
pub fn opencode_discovery_spec() -> DiscoverySpec {
    DiscoverySpec {
        bin_name: "opencode",
        well_known_relative_to_home: vec![".opencode/bin"],
        well_known_absolute: vec!["/opt/homebrew/bin", "/usr/local/bin"],
        version_args: &["--version"],
    }
}

/// Globally-set override for the `opencode` binary path.
///
/// Set once by the host app at startup (e.g. read from settings). The
/// `OpenCodeServer` is a process-wide singleton — once spawned, it stays for
/// the app's lifetime — so a `RwLock<Option<PathBuf>>` is enough; changes
/// after first spawn require an app restart.
static BINARY_OVERRIDE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

/// Set (or clear, with `None`) the override path for the `opencode` binary.
///
/// Wins over `CADENCE_OPENCODE_BIN` and discovery. The host app should call
/// this once at startup with the user's persisted setting.
pub fn set_binary_override(path: Option<PathBuf>) {
    if let Ok(mut guard) = BINARY_OVERRIDE.write() {
        *guard = path;
    }
}

fn current_binary_override() -> Option<PathBuf> {
    BINARY_OVERRIDE.read().ok().and_then(|guard| guard.clone())
}

#[derive(Debug, Clone)]
pub struct OpenCodeServerInfo {
    pub base_url: String,
    pub port: u16,
    pub pid: Option<u32>,
}

pub struct OpenCodeServer {
    child: Option<Child>,
    info: OpenCodeServerInfo,
}

static SERVER: Lazy<Mutex<Option<OpenCodeServer>>> = Lazy::new(|| Mutex::new(None));

impl OpenCodeServer {
    pub async fn ensure_running() -> Result<OpenCodeServerInfo, SdkError> {
        let mut guard = SERVER.lock().await;
        if let Some(server) = guard.as_mut() {
            if server.is_healthy().await {
                return Ok(server.info.clone());
            }
            *guard = None;
        }
        let server = Self::spawn().await?;
        let info = server.info.clone();
        *guard = Some(server);
        Ok(info)
    }

    pub async fn shutdown() -> Result<(), SdkError> {
        let mut guard = SERVER.lock().await;
        if let Some(server) = guard.as_mut() {
            if let Some(child) = server.child.as_mut() {
                child.kill().await?;
            }
        }
        *guard = None;
        Ok(())
    }

    async fn spawn() -> Result<Self, SdkError> {
        if let Ok(base_url) = std::env::var("CADENCE_OPENCODE_BASE_URL") {
            let port = parse_port(&base_url)?;
            let info = OpenCodeServerInfo {
                base_url,
                port,
                pid: None,
            };
            let client = OpenCodeClient::with_base_url(info.base_url.clone());
            wait_for_health(&client).await?;
            return Ok(Self { child: None, info });
        }

        let default_client = OpenCodeClient::new(4096);
        if default_client.health().await.is_ok() {
            return Ok(Self {
                child: None,
                info: OpenCodeServerInfo {
                    base_url: "http://127.0.0.1:4096".to_string(),
                    port: 4096,
                    pid: None,
                },
            });
        }

        let opencode_command = resolved_opencode_command().await;
        info!(command = %opencode_command.display(), "spawning opencode server");
        let mut child = Command::new(&opencode_command)
            .arg("serve")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                SdkError::Spawn(format!("{} ({})", error, opencode_command.display()))
            })?;

        let pid = child.id();
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SdkError::Spawn("missing stdout pipe".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| SdkError::Spawn("missing stderr pipe".to_string()))?;

        let (tx, mut rx) = mpsc::channel::<String>(64);
        spawn_output_reader(stdout, tx.clone());
        spawn_output_reader(stderr, tx);

        let discovered_port = wait_for_port_from_logs(&mut rx).await.unwrap_or(4096);
        let base_url = format!("http://127.0.0.1:{discovered_port}");
        let client = OpenCodeClient::with_base_url(base_url.clone());
        wait_for_health(&client).await?;

        info!(port = discovered_port, pid = ?pid, "opencode server started");
        Ok(Self {
            child: Some(child),
            info: OpenCodeServerInfo {
                base_url,
                port: discovered_port,
                pid,
            },
        })
    }

    async fn is_healthy(&mut self) -> bool {
        if let Some(child) = self.child.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) => return false,
                Ok(None) => {}
                Err(_) => return false,
            }
        }
        let client = OpenCodeClient::with_base_url(self.info.base_url.clone());
        client.health().await.is_ok()
    }
}

fn spawn_output_reader<T>(stream: T, tx: mpsc::Sender<String>)
where
    T: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(stream).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if tx.send(line).await.is_err() {
                break;
            }
        }
    });
}

async fn wait_for_port_from_logs(rx: &mut mpsc::Receiver<String>) -> Option<u16> {
    let matcher = Regex::new(r":(\d{2,5})").ok()?;
    let timeout = tokio::time::sleep(Duration::from_secs(15));
    tokio::pin!(timeout);
    loop {
        tokio::select! {
            _ = &mut timeout => return None,
            line = rx.recv() => {
                let Some(line) = line else { return None; };
                if let Some(captured) = matcher.captures(&line) {
                    if let Ok(port) = captured[1].parse::<u16>() {
                        return Some(port);
                    }
                }
            }
        }
    }
}

async fn wait_for_health(client: &OpenCodeClient) -> Result<(), SdkError> {
    for _ in 0..80 {
        if client.health().await.is_ok() {
            return Ok(());
        }
        sleep(Duration::from_millis(250)).await;
    }
    warn!(
        base_url = client.base_url(),
        "timed out waiting for opencode health check"
    );
    Err(SdkError::Timeout(format!(
        "OpenCode health check failed for {}",
        client.base_url()
    )))
}

fn parse_port(base_url: &str) -> Result<u16, SdkError> {
    let parsed = reqwest::Url::parse(base_url)
        .map_err(|error| SdkError::InvalidBaseUrl(error.to_string()))?;
    parsed
        .port_or_known_default()
        .ok_or_else(|| SdkError::MissingPort(base_url.to_string()))
}

/// Resolve the `opencode` binary path with the documented precedence:
/// 1. Settings-backed override (set by the host app via `set_binary_override`).
/// 2. Legacy `CADENCE_OPENCODE_BIN` env var (kept for backwards compat).
/// 3. Multi-install discovery via `cli_discovery::discover_all` — picks
///    the highest semver across `$PATH`, login-shell PATH, and well-known
///    install dirs.
///
/// Falls back to the bare `"opencode"` string (so `Command::new` will defer
/// to whatever the OS finds) only when nothing concrete is discovered.
async fn resolved_opencode_command() -> PathBuf {
    if let Some(command) = current_binary_override() {
        info!(command = %command.display(), "using opencode binary override");
        return command;
    }

    if let Some(command) = legacy_env_opencode_command() {
        info!(command = %command.display(), "using CADENCE_OPENCODE_BIN");
        return command;
    }

    let spec = opencode_discovery_spec();
    let candidates = cli_discovery::discover_all(&spec, None).await;
    if candidates.is_empty() {
        info!("no concrete opencode binaries discovered; falling back to PATH resolution");
        return PathBuf::from(spec.bin_name);
    }

    log_candidate_selection(&candidates);
    cli_discovery::select_best(&candidates)
        .map(|candidate| candidate.path.clone())
        .unwrap_or_else(|| PathBuf::from(spec.bin_name))
}

fn legacy_env_opencode_command() -> Option<PathBuf> {
    std::env::var_os("CADENCE_OPENCODE_BIN")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

fn log_candidate_selection(candidates: &[cli_discovery::Candidate]) {
    let resolved = candidates
        .iter()
        .map(|candidate| match &candidate.version {
            Some(version) => {
                format!(
                    "{}@{}",
                    candidate.path.display(),
                    version.to_string_dotted()
                )
            }
            None => format!("{}@unknown", candidate.path.display()),
        })
        .collect::<Vec<_>>();
    match cli_discovery::select_best(candidates) {
        Some(selected) => info!(
            candidates = ?resolved,
            selected = %selected.path.display(),
            "resolved opencode binary"
        ),
        None => warn!(candidates = ?resolved, "failed to select an opencode binary"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencode_discovery_spec_includes_user_install_and_homebrew() {
        let spec = opencode_discovery_spec();
        assert_eq!(spec.bin_name, "opencode");
        assert!(spec.well_known_relative_to_home.contains(&".opencode/bin"));
        assert!(spec.well_known_absolute.contains(&"/opt/homebrew/bin"));
    }

    #[test]
    fn binary_override_round_trips() {
        // Save and restore so this test doesn't leak state into the shared
        // singleton used by other tests in the same process.
        let prior = current_binary_override();
        set_binary_override(Some(PathBuf::from("/custom/opencode")));
        assert_eq!(
            current_binary_override(),
            Some(PathBuf::from("/custom/opencode"))
        );
        set_binary_override(None);
        assert!(current_binary_override().is_none());
        set_binary_override(prior);
    }
}
