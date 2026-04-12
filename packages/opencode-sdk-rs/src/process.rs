use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use once_cell::sync::Lazy;
use regex_lite::Regex;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};
use tokio::time::sleep;
use tracing::{info, warn};

use crate::client::OpenCodeClient;
use crate::error::SdkError;

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
struct VersionKey(u64, u64, u64);

#[derive(Clone, Debug, Eq, PartialEq)]
struct BinaryCandidate {
    path: PathBuf,
    version: Option<VersionKey>,
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

async fn resolved_opencode_command() -> PathBuf {
    if let Some(command) = configured_opencode_command() {
        info!(command = %command.display(), "using configured opencode binary");
        return command;
    }

    let candidates = discover_opencode_commands(
        std::env::var_os("HOME").map(PathBuf::from),
        std::env::var_os("PATH"),
        |path| path.is_file(),
    );
    if candidates.is_empty() {
        info!("no concrete opencode binaries discovered; falling back to PATH resolution");
        return PathBuf::from("opencode");
    }

    let inspected = inspect_opencode_candidates(candidates).await;
    log_candidate_selection(&inspected);
    select_best_opencode_candidate(&inspected)
        .map(|candidate| candidate.path.clone())
        .unwrap_or_else(|| PathBuf::from("opencode"))
}

fn configured_opencode_command() -> Option<PathBuf> {
    std::env::var_os("CADENCE_OPENCODE_BIN")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

fn discover_opencode_commands<F>(
    home_dir: Option<PathBuf>,
    path_var: Option<std::ffi::OsString>,
    path_exists: F,
) -> Vec<PathBuf>
where
    F: Fn(&Path) -> bool,
{
    let mut seen = HashSet::new();
    let mut commands = Vec::new();
    if let Some(home_dir) = home_dir {
        let user_install = home_dir.join(".opencode/bin/opencode");
        if path_exists(&user_install) && seen.insert(user_install.clone()) {
            commands.push(user_install);
        }
    }

    if let Some(path_var) = path_var {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(format!("opencode{}", std::env::consts::EXE_SUFFIX));
            if path_exists(&candidate) && seen.insert(candidate.clone()) {
                commands.push(candidate);
            }
        }
    }

    commands
}

async fn inspect_opencode_candidates(commands: Vec<PathBuf>) -> Vec<BinaryCandidate> {
    let mut inspected = Vec::with_capacity(commands.len());
    for path in commands {
        let version = query_opencode_version(&path).await;
        inspected.push(BinaryCandidate { path, version });
    }
    inspected
}

async fn query_opencode_version(command: &Path) -> Option<VersionKey> {
    let output = Command::new(command).arg("--version").output().await.ok()?;
    parse_opencode_version_output(&String::from_utf8_lossy(&output.stdout))
        .or_else(|| parse_opencode_version_output(&String::from_utf8_lossy(&output.stderr)))
}

fn parse_opencode_version_output(raw: &str) -> Option<VersionKey> {
    let matcher = Regex::new(r"(?m)\b(\d+)\.(\d+)\.(\d+)\b").ok()?;
    let captures = matcher.captures(raw)?;
    Some(VersionKey(
        captures.get(1)?.as_str().parse().ok()?,
        captures.get(2)?.as_str().parse().ok()?,
        captures.get(3)?.as_str().parse().ok()?,
    ))
}

fn select_best_opencode_candidate(candidates: &[BinaryCandidate]) -> Option<&BinaryCandidate> {
    let mut best: Option<&BinaryCandidate> = None;
    for candidate in candidates {
        match best {
            None => best = Some(candidate),
            Some(current) => {
                let candidate_key = candidate.version.as_ref();
                let current_key = current.version.as_ref();
                if candidate_key > current_key {
                    best = Some(candidate);
                }
            }
        }
    }
    best
}

fn log_candidate_selection(candidates: &[BinaryCandidate]) {
    let selected = select_best_opencode_candidate(candidates);
    let resolved = candidates
        .iter()
        .map(|candidate| match &candidate.version {
            Some(version) => format!(
                "{}@{}.{}.{}",
                candidate.path.display(),
                version.0,
                version.1,
                version.2
            ),
            None => format!("{}@unknown", candidate.path.display()),
        })
        .collect::<Vec<_>>();
    if let Some(selected) = selected {
        info!(
            candidates = ?resolved,
            selected = %selected.path.display(),
            "resolved opencode binary"
        );
    } else {
        warn!(candidates = ?resolved, "failed to select an opencode binary");
    }
}

#[cfg(test)]
#[rustfmt::skip]
mod tests {
    use super::{discover_opencode_commands, parse_opencode_version_output, select_best_opencode_candidate, BinaryCandidate, VersionKey};
    use std::path::{Path, PathBuf};

    fn candidate(path: &str, version: Option<VersionKey>) -> BinaryCandidate {
        BinaryCandidate { path: PathBuf::from(path), version }
    }

    #[test]
    fn discovers_commands_and_parses_versions() {
        let commands = discover_opencode_commands(Some(PathBuf::from("/Users/test")), Some("/opt/custom/bin:/opt/homebrew/bin".into()), |path| {
            path == Path::new("/Users/test/.opencode/bin/opencode")
                || path == Path::new("/opt/custom/bin/opencode")
                || path == Path::new("/opt/homebrew/bin/opencode")
        });
        assert_eq!(commands, vec![
            PathBuf::from("/Users/test/.opencode/bin/opencode"),
            PathBuf::from("/opt/custom/bin/opencode"),
            PathBuf::from("/opt/homebrew/bin/opencode"),
        ]);
        assert_eq!(parse_opencode_version_output("1.4.3"), Some(VersionKey(1, 4, 3)));
        assert_eq!(parse_opencode_version_output("ERROR service=models.dev\n1.1.65\n"), Some(VersionKey(1, 1, 65)));
    }

    #[test]
    fn selects_best_candidate_or_falls_back_to_first() {
        let selected = select_best_opencode_candidate(&[
            candidate("/Users/test/.opencode/bin/opencode", Some(VersionKey(1, 4, 3))),
            candidate("/opt/homebrew/bin/opencode", Some(VersionKey(1, 1, 65))),
        ]).unwrap().path.clone();
        assert_eq!(selected, PathBuf::from("/Users/test/.opencode/bin/opencode"));

        let fallback = select_best_opencode_candidate(&[
            candidate("/Users/test/.opencode/bin/opencode", None),
            candidate("/opt/homebrew/bin/opencode", None),
        ]).unwrap().path.clone();
        assert_eq!(fallback, PathBuf::from("/Users/test/.opencode/bin/opencode"));
    }
}
