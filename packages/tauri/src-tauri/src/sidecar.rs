use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

const SIDECAR_PORT: u16 = 5005;
const HEALTH_CHECK_RETRIES: u32 = 30;
const HEALTH_CHECK_INTERVAL_MS: u64 = 200;
pub struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    pub port: u16,
}

impl SidecarState {
    fn new(child: CommandChild, port: u16) -> Self {
        Self {
            child: Mutex::new(Some(child)),
            port,
        }
    }
}

pub fn spawn_sidecar(app: &tauri::AppHandle) -> Result<SidecarState, String> {
    let db_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;

    std::fs::create_dir_all(&db_dir)
        .map_err(|e| format!("Failed to create app data dir: {e}"))?;

    let db_path = db_dir.join("cadence.db");
    let port = SIDECAR_PORT;

    let (mut rx, child) = app
        .shell()
        .sidecar("cadence-service")
        .map_err(|e| format!("Failed to create sidecar command: {e}"))?
        .args([
            "--db-path",
            db_path.to_str().unwrap_or("cadence.db"),
            "--port",
            &port.to_string(),
        ])
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    // Log sidecar output in background
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
                    break;
                }
                _ => {}
            }
        }
    });

    log::info!("Sidecar spawned on port {port}, waiting for health check...");
    Ok(SidecarState::new(child, port))
}

pub async fn wait_for_healthy(port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/api/health");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    for i in 0..HEALTH_CHECK_RETRIES {
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                log::info!("Health check passed after {i} retries");
                return Ok(());
            }
            _ => {
                tokio::time::sleep(std::time::Duration::from_millis(HEALTH_CHECK_INTERVAL_MS))
                    .await;
            }
        }
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
        log::info!("Sending SIGTERM to cadence-service...");
        if let Err(e) = child.kill() {
            log::error!("Failed to kill sidecar: {e}");
            return;
        }

        // CommandChild::kill() sends SIGKILL on Unix. Tauri's shell plugin
        // doesn't expose SIGTERM directly, so kill() is the best we can do.
        // The sidecar should handle graceful shutdown on its own via OS signals.
        log::info!("Sidecar process terminated");
    }
}
