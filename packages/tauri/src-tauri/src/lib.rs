mod sidecar;

use base64::Engine;
use std::path::{Component, PathBuf};
use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Manager;

const MAX_READ_FILE_BYTES: u64 = 16 * 1024 * 1024;

/// Reads an image the user dropped into the window. The OS-level drag
/// gesture is the authorisation; we only keep the lightweight defenses
/// (reject raw `..`, canonicalise, size cap).
#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let raw = PathBuf::from(&path);
    if raw
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("Rejected: path contains `..`".to_string());
    }

    let canonical = raw
        .canonicalize()
        .map_err(|e| format!("Cannot resolve {path}: {e}"))?;

    let metadata = std::fs::metadata(&canonical)
        .map_err(|e| format!("Cannot stat {}: {e}", canonical.display()))?;
    if metadata.len() > MAX_READ_FILE_BYTES {
        return Err(format!(
            "Rejected: file is {} bytes, limit is {} bytes.",
            metadata.len(),
            MAX_READ_FILE_BYTES
        ));
    }

    let bytes = std::fs::read(&canonical)
        .map_err(|e| format!("Failed to read {}: {e}", canonical.display()))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[derive(serde::Serialize, Clone)]
struct RuntimeConfig {
    port: u16,
    #[serde(rename = "authToken")]
    auth_token: Option<String>,
}

#[tauri::command]
fn get_runtime_config(state: tauri::State<'_, sidecar::SidecarState>) -> RuntimeConfig {
    RuntimeConfig {
        port: state.port,
        auth_token: state.auth_token.clone(),
    }
}

const SECURITY_NO_TOKEN_BANNER: &str = "\n\
    ================================================================\n\
    CADENCE_AUTH_TOKEN is missing.\n\
    The sidecar refuses to start without it; the UI will fail to\n\
    connect until you fix this.\n\
    \n\
    To fix: quit, then run `pnpm dev` from the repo root. That\n\
    invokes `scripts/ensure-dev-token.mjs`, which writes a random\n\
    token to `.env` — loaded by both crates via `dotenvy` at startup.\n\
    ================================================================";

fn load_dotenv_from_manifest() -> Option<std::path::PathBuf> {
    let mut dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    loop {
        let candidate = dir.join(".env");
        if dotenvy::from_path(&candidate).is_ok() {
            return Some(candidate);
        }
        if !dir.pop() {
            return None;
        }
    }
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
        .invoke_handler(tauri::generate_handler![
            read_file_base64,
            get_runtime_config
        ])
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
                // Dev-mode token comes from repo-root `.env`; prod mints one
                // per launch in `spawn_sidecar` instead.
                match load_dotenv_from_manifest() {
                    Some(path) => log::info!("Loaded env from {}", path.display()),
                    None => log::warn!(
                        "No .env found walking up from CARGO_MANIFEST_DIR; \
                         CADENCE_AUTH_TOKEN must come from the process env."
                    ),
                }

                let state = sidecar::SidecarState::dev_mode();
                if state.auth_token.is_none() {
                    log::error!("{}", SECURITY_NO_TOKEN_BANNER);
                } else {
                    log::info!("Dev mode: CADENCE_AUTH_TOKEN loaded; auth enabled.");
                }
                app.manage(state);
                return Ok(());
            }

            let handle = app.handle().clone();
            let spawn_result = sidecar::spawn_sidecar(&handle)
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

            let port = spawn_result.state.port;
            let token = spawn_result.state.auth_token.clone();
            let exited = spawn_result.exited;
            app.manage(spawn_result.state);

            tauri::async_runtime::block_on(async {
                sidecar::wait_for_healthy(port, token.as_deref(), exited).await
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
