fn main() {
    tauri_plugin::Builder::new(&["send_notification", "check_permission"]).build();
}
