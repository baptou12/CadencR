use subtle::ConstantTimeEq;

pub const SERVICE_AUTH_TOKEN_ENV: &str = "CADENCR_AUTH_TOKEN";

pub fn constant_time_str_eq(left: &str, right: &str) -> bool {
    bool::from(left.as_bytes().ct_eq(right.as_bytes()))
}

/// Populate a PTY command with the service's hydrated environment while
/// excluding credentials that belong only to the service process.
pub fn inherit_sanitized_pty_env(command: &mut portable_pty::CommandBuilder) {
    for (key, value) in std::env::vars_os() {
        if key != SERVICE_AUTH_TOKEN_ENV {
            command.env(key, value);
        }
    }
    command.env_remove(SERVICE_AUTH_TOKEN_ENV);
}
