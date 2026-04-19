use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const SIDECAR_PORT: u16 = 5005;
const HEALTH_CHECK_RETRIES: u32 = 30;
const HEALTH_CHECK_INTERVAL_MS: u64 = 200;

/// Paired with the bearer-token check, the `service` field here rejects an
/// imposter process that bound our port before we could.
#[derive(Deserialize)]
struct HealthBody {
    service: String,
}

pub struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    pub port: u16,
    pub auth_token: Option<String>,
}

impl SidecarState {
    fn new(child: CommandChild, port: u16, auth_token: String) -> Self {
        Self {
            child: Mutex::new(Some(child)),
            port,
            auth_token: Some(auth_token),
        }
    }

    /// Used in dev mode where the sidecar is run manually; picks up the
    /// token from the process env (loaded from `.env` by `lib.rs`).
    pub fn dev_mode() -> Self {
        let port = std::env::var("CADENCE_RUST_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(SIDECAR_PORT);
        let auth_token = std::env::var("CADENCE_AUTH_TOKEN").ok().filter(|t| !t.is_empty());
        Self {
            child: Mutex::new(None),
            port,
            auth_token,
        }
    }
}

fn generate_auth_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub struct SpawnResult {
    pub state: SidecarState,
    /// Flipped by the log-pump on `CommandEvent::Terminated` so the health
    /// checker aborts on early exit instead of retrying to timeout.
    pub exited: Arc<AtomicBool>,
}

pub fn spawn_sidecar(app: &tauri::AppHandle) -> Result<SpawnResult, String> {
    let db_dir = dirs::data_dir()
        .ok_or_else(|| "Failed to get data dir".to_string())?
        .join("cadence");

    std::fs::create_dir_all(&db_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;

    let db_path = db_dir.join("cadence.db");
    let port = SIDECAR_PORT;
    let auth_token = generate_auth_token();

    let (mut rx, child) = app
        .shell()
        .sidecar("cadence-service")
        .map_err(|e| format!("Failed to create sidecar command: {e}"))?
        .args([
            "--db-path",
            db_path.to_str().unwrap_or("cadence.db"),
            "--port",
            &port.to_string(),
            "--auth-token",
            &auth_token,
        ])
        // Also as env so the token isn't visible in `ps` argv.
        .env("CADENCE_AUTH_TOKEN", &auth_token)
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    let exited = Arc::new(AtomicBool::new(false));
    let exited_signal = Arc::clone(&exited);

    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!("[cadence-service] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    log::warn!("[cadence-service] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(status) => {
                    log::info!("[cadence-service] terminated: {status:?}");
                    exited_signal.store(true, Ordering::SeqCst);
                    break;
                }
                _ => {}
            }
        }
    });

    log::info!("Sidecar spawned on port {port}, waiting for health check...");
    Ok(SpawnResult {
        state: SidecarState::new(child, port, auth_token),
        exited,
    })
}

/// Handshake: token + body-shape check together reject an imposter that
/// grabbed our port. Aborts early if the child exits during probing.
pub async fn wait_for_healthy(
    port: u16,
    auth_token: Option<&str>,
    exited: Arc<AtomicBool>,
) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/api/health");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    for i in 0..HEALTH_CHECK_RETRIES {
        if exited.load(Ordering::SeqCst) {
            return Err(
                "cadence-service exited before passing health check \
                 (is port 5005 already in use?)"
                    .to_string(),
            );
        }

        let mut req = client.get(&url);
        if let Some(tok) = auth_token {
            req = req.header("x-cadence-token", tok);
        }
        match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<HealthBody>().await {
                    Ok(body) if body.service == "cadence" => {
                        log::info!("Health check passed after {i} retries");
                        return Ok(());
                    }
                    Ok(body) => {
                        return Err(format!(
                            "Health check responder identified itself as '{}', \
                             not 'cadence'. Refusing to connect.",
                            body.service
                        ));
                    }
                    Err(e) => {
                        return Err(format!(
                            "Health check returned 200 but body was not JSON we \
                             recognise: {e}"
                        ));
                    }
                }
            }
            Ok(resp) => {
                log::debug!("Health check got status {} (retry {i})", resp.status());
            }
            Err(_) => {}
        }
        tokio::time::sleep(std::time::Duration::from_millis(HEALTH_CHECK_INTERVAL_MS)).await;
    }

    Err(format!(
        "Health check failed after {HEALTH_CHECK_RETRIES} retries ({} seconds)",
        HEALTH_CHECK_RETRIES as u64 * HEALTH_CHECK_INTERVAL_MS / 1000
    ))
}

pub fn stop_sidecar(state: &SidecarState) {
    let mut guard = match state.child.lock() {
        Ok(g) => g,
        Err(e) => {
            log::error!("Failed to lock sidecar state: {e}");
            return;
        }
    };

    if let Some(child) = guard.take() {
        log::info!("Stopping cadence-service...");
        if let Err(e) = child.kill() {
            log::error!("Failed to kill sidecar: {e}");
            return;
        }

        // Tauri's shell plugin only exposes SIGKILL; the sidecar must
        // handle graceful shutdown via its own signal handler.
        log::info!("Sidecar process terminated");
    }
}
