use std::path::PathBuf;

/// Directory holding the remote-access cert, key, and device-token pepper.
/// Lives next to the database under `~/.cadencr/remote/`. Fail closed when the
/// home directory cannot be resolved rather than placing persistent credentials
/// in a working directory or predictable shared temporary path.
pub fn remote_data_dir() -> anyhow::Result<PathBuf> {
    remote_data_dir_from_home(dirs::home_dir())
}

fn remote_data_dir_from_home(home: Option<PathBuf>) -> anyhow::Result<PathBuf> {
    home.ok_or_else(|| anyhow::anyhow!("cannot resolve home directory for remote credentials"))
        .map(|home| home.join(".cadencr").join("remote"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_home_fails_closed() {
        assert!(remote_data_dir_from_home(None).is_err());
    }
}
