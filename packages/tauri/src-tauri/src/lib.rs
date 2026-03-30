mod sidecar;

use base64::Engine;
use tauri::Manager;

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read {path}: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification_router::init())
        .invoke_handler(tauri::generate_handler![read_file_base64])
        .setup(|app| {
            if cfg!(dev) {
                log::info!("Dev mode: skipping sidecar spawn (run cadence-service manually)");
                return Ok(());
            }

            let handle = app.handle().clone();
            let state = sidecar::spawn_sidecar(&handle)
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

            let port = state.port;
            app.manage(state);

            // Wait for health check on the async runtime
            tauri::async_runtime::block_on(async {
                sidecar::wait_for_healthy(port).await
            })
            .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

            log::info!("cadence-service is healthy on port {port}");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<sidecar::SidecarState>() {
                    sidecar::stop_sidecar(&state);
                }
            }
        });
}
