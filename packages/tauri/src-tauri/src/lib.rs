mod sidecar;

use base64::Engine;
use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Manager;

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read {path}: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification_router::init());

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .invoke_handler(tauri::generate_handler![read_file_base64])
        .menu(|handle| {
            // Custom menu that omits CMD+W (Close Window) so the frontend controls it
            let app_menu = Submenu::with_items(
                handle,
                "Cadence",
                true,
                &[
                    &PredefinedMenuItem::about(
                        handle,
                        Some("About Cadence"),
                        Some(AboutMetadataBuilder::new().build()),
                    )?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::hide(handle, None)?,
                    &PredefinedMenuItem::hide_others(handle, None)?,
                    &PredefinedMenuItem::show_all(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::quit(handle, None)?,
                ],
            )?;
            let edit_menu = Submenu::with_items(
                handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(handle, None)?,
                    &PredefinedMenuItem::redo(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::cut(handle, None)?,
                    &PredefinedMenuItem::copy(handle, None)?,
                    &PredefinedMenuItem::paste(handle, None)?,
                    &PredefinedMenuItem::select_all(handle, None)?,
                ],
            )?;
            let window_menu = Submenu::with_items(
                handle,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(handle, None)?,
                    &MenuItem::new(handle, "Zoom", true, None::<&str>)?,
                    &PredefinedMenuItem::fullscreen(handle, None)?,
                ],
            )?;
            Menu::with_items(handle, &[&app_menu, &edit_menu, &window_menu])
        })
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
            tauri::async_runtime::block_on(async { sidecar::wait_for_healthy(port).await })
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
