mod sidecar;

use base64::Engine;
use std::path::{Component, Path, PathBuf};
use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Manager;

const MAX_READ_FILE_BYTES: u64 = 16 * 1024 * 1024;
const TAURI_DOTENV_DISPLAY_PATH: &str = "packages/tauri/.env";
const TAURI_DOTENV_EXAMPLE_PATH: &str = "packages/tauri/.env.example";
const REQUIRED_DEV_ENV_KEYS: [&str; 3] = ["VITE_FRONTEND_PORT", "VITE_API_URL", "VITE_API_TOKEN"];

fn tauri_package_dir() -> PathBuf {
    tauri_package_dir_from_manifest(env!("CARGO_MANIFEST_DIR"))
}

fn tauri_package_dir_from_manifest(manifest_dir: impl AsRef<std::path::Path>) -> PathBuf {
    manifest_dir
        .as_ref()
        .parent()
        .expect("src-tauri crate should live under the tauri package root")
        .to_path_buf()
}

fn tauri_dotenv_path(package_dir: impl AsRef<Path>) -> PathBuf {
    package_dir.as_ref().join(".env")
}

fn load_optional_package_dotenv(package_dir: impl AsRef<Path>) -> Result<Option<PathBuf>, String> {
    let dotenv_path = tauri_dotenv_path(package_dir);
    if !dotenv_path.is_file() {
        return Ok(None);
    }

    dotenvy::from_path(&dotenv_path)
        .map_err(|error| format!("Failed to load `{TAURI_DOTENV_DISPLAY_PATH}`: {error}"))?;

    Ok(Some(dotenv_path))
}

fn require_dev_env_file(dotenv_path: Option<PathBuf>) -> Result<PathBuf, String> {
    dotenv_path.ok_or_else(|| {
        format!(
            "Missing required dev env file `{TAURI_DOTENV_DISPLAY_PATH}`. Copy \
             `{TAURI_DOTENV_EXAMPLE_PATH}` to `{TAURI_DOTENV_DISPLAY_PATH}`."
        )
    })
}

fn validate_required_env_keys(display_path: &str, required_keys: &[&str]) -> Result<(), String> {
    let missing = required_keys
        .iter()
        .copied()
        .filter(|key| {
            std::env::var(key)
                .ok()
                .is_none_or(|value| value.trim().is_empty())
        })
        .collect::<Vec<_>>();

    if missing.is_empty() {
        return Ok(());
    }

    Err(format!(
        "Missing required keys in `{display_path}`: {}.",
        missing.join(", ")
    ))
}

/// Reads an image the user dropped into the window. The OS-level drag
/// gesture is the authorisation; we only keep the lightweight defenses
/// (reject raw `..`, canonicalise, size cap).
#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let raw = PathBuf::from(&path);
    if raw.components().any(|c| matches!(c, Component::ParentDir)) {
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
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "authToken")]
    auth_token: Option<String>,
}

#[tauri::command]
fn get_runtime_config(state: tauri::State<'_, sidecar::SidecarState>) -> RuntimeConfig {
    RuntimeConfig {
        base_url: state.base_url.clone(),
        auth_token: state.auth_token.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        load_optional_package_dotenv, require_dev_env_file, tauri_dotenv_path, tauri_package_dir,
        tauri_package_dir_from_manifest, validate_required_env_keys, REQUIRED_DEV_ENV_KEYS,
        TAURI_DOTENV_DISPLAY_PATH,
    };
    use std::fs;
    use std::sync::{Mutex, OnceLock};
    use tempfile::tempdir;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn clear_env(keys: &[&str]) {
        for key in keys {
            std::env::remove_var(key);
        }
    }

    #[test]
    fn package_dotenv_path_resolves_from_src_tauri_manifest_dir() {
        let workspace = tempdir().unwrap();
        let tauri_src_tauri_dir = workspace.path().join("tauri/src-tauri");
        let tauri_dir = workspace.path().join("tauri");

        fs::create_dir_all(&tauri_src_tauri_dir).unwrap();

        assert_eq!(
            tauri_package_dir_from_manifest(&tauri_src_tauri_dir),
            tauri_dir
        );
        assert_eq!(
            tauri_dotenv_path(tauri_package_dir_from_manifest(&tauri_src_tauri_dir)),
            tauri_dir.join(".env")
        );
    }

    #[test]
    fn package_dotenv_loads_from_package_root() {
        let _guard = env_lock().lock().unwrap();
        let workspace = tempdir().unwrap();
        let tauri_src_tauri_dir = workspace.path().join("tauri/src-tauri");
        let tauri_dir = workspace.path().join("tauri");

        std::env::remove_var("TAURI_TEST_ONLY");
        std::env::remove_var("TAURI_WRONG_ENV");

        fs::create_dir_all(&tauri_src_tauri_dir).unwrap();
        fs::write(
            tauri_src_tauri_dir.join(".env"),
            "TAURI_WRONG_ENV=src-tauri\n",
        )
        .unwrap();
        fs::write(tauri_dir.join(".env"), "TAURI_TEST_ONLY=package-root\n").unwrap();

        let loaded =
            load_optional_package_dotenv(tauri_package_dir_from_manifest(&tauri_src_tauri_dir))
                .unwrap();

        assert_eq!(loaded, Some(tauri_dir.join(".env")));
        assert_eq!(std::env::var("TAURI_TEST_ONLY").unwrap(), "package-root");
        assert!(std::env::var("TAURI_WRONG_ENV").is_err());

        std::env::remove_var("TAURI_TEST_ONLY");
    }

    #[test]
    fn missing_dev_env_file_is_fatal() {
        let error = require_dev_env_file(None).unwrap_err();

        assert!(error.contains("packages/tauri/.env"));
    }

    #[test]
    fn missing_required_local_keys_are_fatal() {
        let _guard = env_lock().lock().unwrap();
        let workspace = tempdir().unwrap();
        let tauri_dir = workspace.path().join("tauri");
        let tauri_src_tauri_dir = workspace.path().join("tauri/src-tauri");
        let env_path = tauri_dotenv_path(&tauri_dir);

        fs::create_dir_all(&tauri_src_tauri_dir).unwrap();
        clear_env(&REQUIRED_DEV_ENV_KEYS);
        fs::write(
            &env_path,
            "VITE_FRONTEND_PORT=1420\nVITE_API_URL=http://127.0.0.1:5005\nVITE_API_TOKEN=\n",
        )
        .unwrap();
        load_optional_package_dotenv(&tauri_dir).unwrap();

        let error = validate_required_env_keys(TAURI_DOTENV_DISPLAY_PATH, &REQUIRED_DEV_ENV_KEYS)
            .unwrap_err();

        assert!(error.contains("VITE_API_TOKEN"));
        clear_env(&REQUIRED_DEV_ENV_KEYS);
    }

    #[test]
    fn tauri_package_dir_points_to_parent_of_src_tauri() {
        let package_dir = tauri_package_dir();

        assert!(package_dir.ends_with("packages/tauri"));
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
            // No "Help" submenu: macOS gives any submenu literally named "Help"
            // special treatment (it captures Cmd+Shift+? to focus the menu's
            // search field). Since we provide a complete custom menu via
            // Menu::with_items, macOS does not auto-generate one — keyboard
            // shortcuts can be handled freely in the frontend (the shortcuts
            // modal uses Cmd+/ via useGlobalShortcut).
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
                    // Pass an explicit accelerator instead of `None` so muda
                    // handles the keybinding via JS keyboard events (character-based)
                    // rather than macOS's default position-based matching, which
                    // would otherwise fire Quit on Cmd+A on AZERTY layouts where
                    // physical Q sits at the QWERTY A position. See issue #4.
                    &PredefinedMenuItem::quit(handle, Some("CmdOrCtrl+Q"))?,
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
                let package_dir = tauri_package_dir();
                let dotenv_path = load_optional_package_dotenv(&package_dir).map_err(|error| {
                    Box::new(std::io::Error::new(std::io::ErrorKind::Other, error))
                })?;
                let dotenv_path = require_dev_env_file(dotenv_path).map_err(|error| {
                    Box::new(std::io::Error::new(std::io::ErrorKind::Other, error))
                })?;
                validate_required_env_keys(TAURI_DOTENV_DISPLAY_PATH, &REQUIRED_DEV_ENV_KEYS)
                    .map_err(|error| {
                        Box::new(std::io::Error::new(std::io::ErrorKind::Other, error))
                    })?;
                log::info!("Loaded env from {}", dotenv_path.display());

                let state = sidecar::SidecarState::dev_mode().map_err(|error| {
                    Box::new(std::io::Error::new(std::io::ErrorKind::Other, error))
                })?;
                app.manage(state);
                return Ok(());
            }

            let handle = app.handle().clone();
            let spawn_result = sidecar::spawn_sidecar(&handle)
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

            let base_url = spawn_result.state.base_url.clone();
            let token = spawn_result.state.auth_token.clone();
            let exited = spawn_result.exited;
            app.manage(spawn_result.state);

            tauri::async_runtime::block_on(async {
                sidecar::wait_for_healthy(&base_url, token.as_deref(), exited).await
            })
            .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

            log::info!("cadence-service is healthy at {base_url}");

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
