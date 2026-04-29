//! Emits the OpenAPI 3 spec for the cadencr service to disk.
//!
//! Used by `pnpm --filter @cadencr/desktop generate:api` to feed orval. The
//! output file is intentionally gitignored — the source of truth is the Rust
//! `utoipa` annotations, and the generated TypeScript client is what gets
//! committed.

use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let spec = cadencr_service::api::openapi::api_doc();
    let json = match serde_json::to_string_pretty(&spec) {
        Ok(s) => s,
        Err(err) => {
            eprintln!("dump-openapi: failed to serialize spec: {err}");
            return ExitCode::FAILURE;
        }
    };

    let out_path = match resolve_output_path() {
        Ok(path) => path,
        Err(err) => {
            eprintln!("dump-openapi: {err}");
            return ExitCode::FAILURE;
        }
    };

    let mut payload = json;
    payload.push('\n');
    if let Err(err) = fs::write(&out_path, payload) {
        eprintln!(
            "dump-openapi: failed to write {}: {err}",
            out_path.display()
        );
        return ExitCode::FAILURE;
    }

    println!("dump-openapi: wrote {}", out_path.display());
    ExitCode::SUCCESS
}

/// Default to `<crate>/openapi.json`. First positional argument overrides.
fn resolve_output_path() -> Result<PathBuf, String> {
    if let Some(arg) = env::args().nth(1) {
        return Ok(PathBuf::from(arg));
    }
    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    Ok(crate_dir.join("openapi.json"))
}
