mod sidecar;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<sidecar::SidecarState>() {
                    sidecar::stop_sidecar(&state);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
