//! Test-only helpers shared across the `query` submodules.
//!
//! This module contains **no tests** — only fixtures used by tests in
//! sibling submodules. The `inline-rust-tests` rule forbids a sibling
//! `tests.rs` for unit tests; a helpers module is structurally different.

#![cfg(test)]

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/// Write `script` to `<dir>/claude` and chmod +x. Returns the path.
///
/// Replaces the ~7-line boilerplate every mock-CLI test would otherwise
/// repeat.
pub(super) fn write_mock_cli(dir: &Path, script: &str) -> PathBuf {
    let script_path = dir.join("claude");
    std::fs::write(&script_path, script).unwrap();
    let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&script_path, perms).unwrap();
    script_path
}
