use crate::error::AppError;

/// Map the host `target_arch`/`target_os` to the strings rust-analyzer (and
/// similar) use in their release asset names.
pub fn current_platform_tag() -> Result<(&'static str, &'static str), AppError> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        other => {
            return Err(AppError::Internal(format!(
                "no LSP release asset available for arch {other:?}"
            )));
        }
    };
    let os = match std::env::consts::OS {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-gnu",
        other => {
            return Err(AppError::Internal(format!(
                "no LSP release asset available for os {other:?}"
            )));
        }
    };
    Ok((arch, os))
}
