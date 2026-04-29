use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// Production always binds the bundled sidecar to a fixed local port; the env
// knobs are intentionally dev-only and do not affect packaged builds.
// Prod uses 5004 / 1419 so a dev instance (defaults 5005 / 1420 from .env)
// can run alongside an installed prod build without port collisions.
const SIDECAR_PORT: u16 = 5004;
#[allow(dead_code)]
const FRONTEND_PORT: u16 = 1419;
const HEALTH_CHECK_RETRIES: u32 = 30;
const HEALTH_CHECK_INTERVAL_MS: u64 = 200;
const DEFAULT_DEV_API_BASE_URL: &str = "http://127.0.0.1:5005";

/// Paired with the bearer-token check, the `service` field here rejects an
/// imposter process that bound our port before we could.
#[derive(Deserialize)]
struct HealthBody {
    service: String,
}

pub struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    pub base_url: String,
    pub auth_token: Option<String>,
}

impl SidecarState {
    fn new(child: CommandChild, base_url: String, auth_token: String) -> Self {
        Self {
            child: Mutex::new(Some(child)),
            base_url,
            auth_token: Some(auth_token),
        }
    }

    /// Used in dev mode where the sidecar is run manually; picks up the
    /// token from the process env (loaded from `packages/tauri/.env` by
    /// `lib.rs`).
    pub fn dev_mode() -> Result<Self, String> {
        let base_url = dev_api_base_url()?;
        let auth_token = std::env::var("VITE_API_TOKEN")
            .ok()
            .filter(|token| !token.is_empty());
        Ok(Self {
            child: Mutex::new(None),
            base_url,
            auth_token,
        })
    }
}

fn dev_api_base_url() -> Result<String, String> {
    let raw =
        std::env::var("VITE_API_URL").unwrap_or_else(|_| DEFAULT_DEV_API_BASE_URL.to_string());
    normalize_base_url("VITE_API_URL", &raw)
}

fn normalize_base_url(key: &str, value: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(value)
        .map_err(|error| format!("{key} must be a valid URL: {error}"))?;

    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("{key} must use http:// or https://"));
    }
    if parsed.host_str().is_none() {
        return Err(format!("{key} must include a host"));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(format!("{key} must not include a query or fragment"));
    }
    if parsed.path() != "/" && !parsed.path().is_empty() {
        return Err(format!("{key} must not include a path"));
    }

    let mut normalized = format!(
        "{}://{}",
        parsed.scheme(),
        parsed.host_str().expect("checked host")
    );
    if let Some(port) = parsed.port() {
        normalized.push_str(&format!(":{port}"));
    }

    Ok(normalized)
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
        .join("cadencr");

    std::fs::create_dir_all(&db_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;

    let db_path = db_dir.join("cadencr.db");
    let port = SIDECAR_PORT;
    let base_url = format!("http://127.0.0.1:{port}");
    let auth_token = generate_auth_token();

    let (mut rx, child) = app
        .shell()
        .sidecar("cadencr-service")
        .map_err(|e| format!("Failed to create sidecar command: {e}"))?
        .args([
            "--db-path",
            db_path.to_str().unwrap_or("cadencr.db"),
            "--port",
            &port.to_string(),
            "--auth-token",
            &auth_token,
        ])
        // Also as env so the token isn't visible in `ps` argv.
        .env("CADENCR_AUTH_TOKEN", &auth_token)
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    let exited = Arc::new(AtomicBool::new(false));
    let exited_signal = Arc::clone(&exited);

    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!("[cadencr-service] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    log::warn!("[cadencr-service] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(status) => {
                    log::info!("[cadencr-service] terminated: {status:?}");
                    exited_signal.store(true, Ordering::SeqCst);
                    break;
                }
                _ => {}
            }
        }
    });

    log::info!("Sidecar spawned at {base_url}, waiting for health check...");
    Ok(SpawnResult {
        state: SidecarState::new(child, base_url, auth_token),
        exited,
    })
}

/// Handshake: token + body-shape check together reject an imposter that
/// grabbed our port. Aborts early if the child exits during probing.
pub async fn wait_for_healthy(
    base_url: &str,
    auth_token: Option<&str>,
    exited: Arc<AtomicBool>,
) -> Result<(), String> {
    let url = format!("{}/api/health", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    for i in 0..HEALTH_CHECK_RETRIES {
        if exited.load(Ordering::SeqCst) {
            return Err(format!(
                "cadencr-service exited before passing health check (is {base_url} already in use?)"
            ));
        }

        let mut req = client.get(&url);
        if let Some(tok) = auth_token {
            req = req.header("x-cadencr-token", tok);
        }
        match req.send().await {
            Ok(resp) if resp.status().is_success() => match resp.json::<HealthBody>().await {
                Ok(body) if body.service == "cadencr" => {
                    log::info!("Health check passed after {i} retries");
                    return Ok(());
                }
                Ok(body) => {
                    return Err(format!(
                        "Health check responder identified itself as '{}', \
                             not 'cadencr'. Refusing to connect.",
                        body.service
                    ));
                }
                Err(e) => {
                    return Err(format!(
                        "Health check returned 200 but body was not JSON we \
                             recognise: {e}"
                    ));
                }
            },
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
        log::info!("Stopping cadencr-service...");
        if let Err(e) = child.kill() {
            log::error!("Failed to kill sidecar: {e}");
            return;
        }

        // Tauri's shell plugin only exposes SIGKILL; the sidecar must
        // handle graceful shutdown via its own signal handler.
        log::info!("Sidecar process terminated");
    }
}
