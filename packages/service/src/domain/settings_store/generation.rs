//! Cheap invalidation for long-running consumers of global settings.

use std::sync::atomic::{AtomicU64, Ordering};

static GLOBAL_GENERATION: AtomicU64 = AtomicU64::new(0);

pub fn global() -> u64 {
    GLOBAL_GENERATION.load(Ordering::Acquire)
}

pub(super) fn bump_global() {
    GLOBAL_GENERATION.fetch_add(1, Ordering::AcqRel);
}
