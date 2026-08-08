use crate::domain::settings_store;

const ENABLED_KEY: &str = "retention_compact_archived_enabled";
const DAYS_KEY: &str = "retention_compact_archived_days";
pub(super) const DEFAULT_DAYS: i64 = 30;
const MIN_DAYS: i64 = 1;
const MAX_DAYS: i64 = 365;

/// The configured window, or `None` when the pass must not run.
pub(super) fn window_days() -> Option<i64> {
    // Fail closed: a malformed settings document must never re-enable the only
    // maintenance pass that discards bytes.
    let Some(settings) = settings_store::global_snapshot() else {
        tracing::warn!("retention: settings are unreadable, skipping compaction this sweep");
        return None;
    };
    let enabled = settings
        .get(ENABLED_KEY)
        .map(|value| value == "true")
        .unwrap_or(false);
    if !enabled {
        return None;
    }
    let days = settings
        .get(DAYS_KEY)
        .and_then(|value| value.trim().parse::<i64>().ok())
        .filter(|days| (MIN_DAYS..=MAX_DAYS).contains(days))
        .unwrap_or(DEFAULT_DAYS);
    Some(days)
}

#[derive(Clone, Copy)]
pub(super) enum PolicyGuard {
    Configured {
        generation: u64,
    },
    #[cfg(test)]
    Test(fn(i64) -> bool),
}

impl PolicyGuard {
    pub(super) fn configured() -> Option<(i64, Self)> {
        let generation = settings_store::generation::global();
        let days = window_days()?;
        (generation == settings_store::generation::global())
            .then_some((days, Self::Configured { generation }))
    }

    #[cfg(test)]
    pub(super) fn testing(check: fn(i64) -> bool) -> Self {
        Self::Test(check)
    }

    pub(super) fn is_current(self, _days: i64) -> bool {
        match self {
            Self::Configured { generation } => settings_store::generation::global() == generation,
            #[cfg(test)]
            Self::Test(check) => check(_days),
        }
    }
}
