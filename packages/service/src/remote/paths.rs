use std::path::PathBuf;

/// Directory holding the remote-access cert, key, and device-token pepper.
/// Lives next to the database under `~/.cadencr/remote/`. Falls back to the
/// current directory only if the home dir can't be resolved (dev/test edge).
pub fn remote_data_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".cadencr")
        .join("remote")
}
