//! Cursor Agent CLI discovery and model-catalog helpers.
//!
//! ACP transport remains in Cadencr's provider-neutral service runtime. This
//! crate owns only Cursor CLI concerns: locating the `agent` executable,
//! applying the settings-backed override, and parsing `agent models` output.

mod error;
mod models;
mod process;

pub use error::SdkError;
pub use models::{list_models_from_cli, parse_models_output, CursorModel};
pub use process::{cursor_discovery_spec, resolve_binary, set_binary_override};
