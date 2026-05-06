use crate::error::SdkError;
use crate::server_health::{fetch_server_health, ServerHealth};
use cli_discovery::{query_version, DiscoverySpec, VersionKey};
use once_cell::sync::Lazy;
use regex_lite::Regex;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::RwLock;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::task::JoinHandle;
use tokio::time::sleep;
use tracing::{info, warn};
const DEFAULT_OPENCODE_PORT: u16 = 4096;
const DEFAULT_OPENCODE_BASE_URL: &str = "http://127.0.0.1:4096";
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
/// Wins over `CADENCR_OPENCODE_BIN` and discovery. The host app should call
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
    shutdown_tx: Option<oneshot::Sender<()>>,
    monitor_task: Option<JoinHandle<()>>,
    info: OpenCodeServerInfo,
}

static SERVER: Lazy<Mutex<Option<OpenCodeServer>>> = Lazy::new(|| Mutex::new(None));

impl OpenCodeServer {
    pub async fn ensure_running() -> Result<OpenCodeServerInfo, SdkError> {
        let opencode_command = resolved_opencode_command().await?;
        let mut guard = SERVER.lock().await;
        if let Some(server) = guard.as_mut() {
            if server.is_compatible_with(opencode_command.version).await {
                return Ok(server.info.clone());
            }
            server.request_shutdown().await;
            *guard = None;
        }
        let server = Self::spawn(opencode_command).await?;
        let info = server.info.clone();
        *guard = Some(server);
        Ok(info)
    }

    pub async fn shutdown() -> Result<(), SdkError> {
        let mut guard = SERVER.lock().await;
        if let Some(server) = guard.as_mut() {
            server.request_shutdown().await;
        }
        *guard = None;
        Ok(())
    }

    async fn spawn(opencode_command: ResolvedOpenCodeCommand) -> Result<Self, SdkError> {
        if can_attach_to_default_server(opencode_command.version).await {
            return Ok(Self {
                shutdown_tx: None,
                monitor_task: None,
                info: OpenCodeServerInfo {
                    base_url: DEFAULT_OPENCODE_BASE_URL.to_string(),
                    port: DEFAULT_OPENCODE_PORT,
                    pid: None,
                },
            });
        }

        info!(command = %opencode_command.path.display(), "spawning opencode server");
        let mut child = Command::new(&opencode_command.path)
            .arg("serve")
            .arg("--port")
            .arg("0")
            .kill_on_drop(true)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                SdkError::Spawn(format!("{} ({})", error, opencode_command.path.display()))
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

        let discovered_port = wait_for_port_from_logs(&mut rx).await.ok_or_else(|| {
            SdkError::Timeout("OpenCode did not report a server port".to_string())
        })?;
        let base_url = format!("http://127.0.0.1:{discovered_port}");
        wait_for_matching_health(&base_url, opencode_command.version).await?;

        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let monitor_task = monitor_child(child, shutdown_rx, pid);

        info!(port = discovered_port, pid = ?pid, "opencode server started");
        Ok(Self {
            shutdown_tx: Some(shutdown_tx),
            monitor_task: Some(monitor_task),
            info: OpenCodeServerInfo {
                base_url,
                port: discovered_port,
                pid,
            },
        })
    }

    async fn is_compatible_with(&mut self, expected_version: VersionKey) -> bool {
        server_matches_version(&self.info.base_url, expected_version).await
    }

    async fn request_shutdown(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(task) = self.monitor_task.take() {
            let _ = tokio::time::timeout(Duration::from_secs(2), task).await;
        }
    }
}

fn monitor_child(
    mut child: Child,
    mut shutdown_rx: oneshot::Receiver<()>,
    pid: Option<u32>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        tokio::select! {
            status = child.wait() => {
                match status {
                    Ok(status) => info!(pid = ?pid, exit_status = %status, "opencode server exited"),
                    Err(error) => warn!(pid = ?pid, error = %error, "failed to wait for opencode server"),
                }
            }
            _ = &mut shutdown_rx => {
                if let Err(error) = child.kill().await {
                    warn!(pid = ?pid, error = %error, "failed to kill opencode server");
                }
            }
        }
    })
}

#[derive(Debug, Clone)]
struct ResolvedOpenCodeCommand {
    path: PathBuf,
    version: VersionKey,
}

async fn can_attach_to_default_server(expected_version: VersionKey) -> bool {
    server_matches_version(DEFAULT_OPENCODE_BASE_URL, expected_version).await
}

async fn server_matches_version(base_url: &str, expected_version: VersionKey) -> bool {
    match fetch_server_health(base_url).await {
        Ok(health) if health_matches_version(&health, expected_version) => true,
        Ok(health) => {
            warn!(
                base_url,
                server_version = ?health.version,
                cli_version = ?expected_version,
                "ignoring opencode server with non-matching version"
            );
            false
        }
        Err(_) => false,
    }
}

fn health_matches_version(health: &ServerHealth, expected_version: VersionKey) -> bool {
    health.version == Some(expected_version)
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

async fn wait_for_matching_health(
    base_url: &str,
    expected_version: VersionKey,
) -> Result<(), SdkError> {
    for _ in 0..80 {
        if let Ok(health) = fetch_server_health(base_url).await {
            if health_matches_version(&health, expected_version) {
                return Ok(());
            }
        }
        sleep(Duration::from_millis(250)).await;
    }
    warn!(
        base_url,
        cli_version = ?expected_version,
        "timed out waiting for opencode health check"
    );
    Err(SdkError::Timeout(format!(
        "OpenCode health check failed for {base_url}"
    )))
}

/// Resolve the `opencode` binary path with the documented precedence:
/// 1. Settings-backed override (set by the host app via `set_binary_override`).
/// 2. Legacy `CADENCR_OPENCODE_BIN` env var (kept for backwards compat).
/// 3. Multi-install discovery via `cli_discovery::discover_all` — picks
///    the highest semver across `$PATH`, login-shell PATH, and well-known
///    install dirs.
///
/// Falls back to the bare `"opencode"` string (so `Command::new` will defer
/// to whatever the OS finds) only when nothing concrete is discovered.
async fn resolved_opencode_command() -> Result<ResolvedOpenCodeCommand, SdkError> {
    if let Some(command) = current_binary_override() {
        info!(command = %command.display(), "using opencode binary override");
        return resolved_single_command(command).await;
    }

    if let Some(command) = legacy_env_opencode_command() {
        info!(command = %command.display(), "using CADENCR_OPENCODE_BIN");
        return resolved_single_command(command).await;
    }

    let spec = opencode_discovery_spec();
    let candidates = cli_discovery::discover_all(&spec, None).await;
    if candidates.is_empty() {
        info!("no concrete opencode binaries discovered; falling back to PATH resolution");
        return resolved_single_command(PathBuf::from(spec.bin_name)).await;
    }

    log_candidate_selection(&candidates);
    let Some(candidate) = cli_discovery::select_best(&candidates) else {
        return resolved_single_command(PathBuf::from(spec.bin_name)).await;
    };
    Ok(ResolvedOpenCodeCommand {
        path: candidate.path.clone(),
        version: candidate.version.ok_or_else(|| {
            SdkError::Protocol(format!(
                "failed to parse opencode CLI version from {}",
                candidate.path.display()
            ))
        })?,
    })
}

async fn resolved_single_command(path: PathBuf) -> Result<ResolvedOpenCodeCommand, SdkError> {
    let spec = opencode_discovery_spec();
    let version = query_version(&path, spec.version_args)
        .await
        .ok_or_else(|| {
            SdkError::Protocol(format!(
                "failed to parse opencode CLI version from {}",
                path.display()
            ))
        })?;
    Ok(ResolvedOpenCodeCommand { path, version })
}

fn legacy_env_opencode_command() -> Option<PathBuf> {
    std::env::var_os("CADENCR_OPENCODE_BIN")
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

    #[test]
    fn health_matches_expected_version_only() {
        let health = ServerHealth {
            version: Some(VersionKey(1, 14, 24)),
        };
        assert!(health_matches_version(&health, VersionKey(1, 14, 24)));
        assert!(!health_matches_version(&health, VersionKey(1, 4, 3)));
    }

    #[test]
    fn health_without_version_never_matches() {
        let health = ServerHealth { version: None };
        assert!(!health_matches_version(&health, VersionKey(1, 14, 24)));
    }
}
