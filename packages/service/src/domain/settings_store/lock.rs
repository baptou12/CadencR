//! Process-wide write lock serializing all settings file writes.
//!
//! Writes are read-modify-write over a whole file, so two concurrent writers
//! (even to different keys) could lose an update. A single global async mutex
//! serializes them. Writes are infrequent (debounced UI saves, startup
//! migration) so global serialization is not a bottleneck.

use std::sync::OnceLock;
use tokio::sync::Mutex;

static WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub fn write_lock() -> &'static Mutex<()> {
    WRITE_LOCK.get_or_init(|| Mutex::new(()))
}
