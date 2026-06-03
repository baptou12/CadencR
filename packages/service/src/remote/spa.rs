use std::path::Path;

use tower_http::services::{ServeDir, ServeFile};

/// Serve the built SPA, falling back to `index.html` for any unmatched path so
/// the client-side router (TanStack) can handle deep links. Mounted as the
/// remote router's `fallback_service`, so it only runs for paths the API
/// routers didn't claim.
pub fn spa_service(renderer_dir: &Path) -> ServeDir<ServeFile> {
    ServeDir::new(renderer_dir).fallback(ServeFile::new(renderer_dir.join("index.html")))
}
