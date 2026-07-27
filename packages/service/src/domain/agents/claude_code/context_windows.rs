//! Context windows learned from the CLI itself.
//!
//! Claude Code advertises no context window in its model catalog or its `init`
//! message — the only authoritative source is `result.modelUsage[<model>]
//! .contextWindow`, which lands at the *end* of a turn. That leaves the first
//! turn on any model with nothing to scale the usage bar by. Banking every
//! window the CLI reports closes that gap for every later turn and session.
//!
//! # Keys are the CLI's fully-qualified ids, never normalized
//!
//! `modelUsage` keys and the `init` message's model id share one namespace and
//! both preserve the `[1m]` beta marker (`claude-opus-5[1m]`). The *streaming*
//! model id does not — `message_start` reports the bare `claude-opus-5` even
//! when the 1M beta is active. Since `claude-opus-5` (200k) and
//! `claude-opus-5[1m]` (1M) are genuinely different windows, stripping or
//! fuzzy-matching the marker would conflate them, so lookups are exact and
//! `message_start` ids are deliberately never used as keys.

use std::collections::HashMap;
use std::sync::RwLock;

use serde_json::Value;

use super::events::{init_model_context_window, model_usage_windows};
use super::ClaudeCodeAdapter;

impl ClaudeCodeAdapter {
    fn context_windows_cell(&self) -> &RwLock<HashMap<String, u64>> {
        self.cached_context_windows
            .get_or_init(|| RwLock::new(HashMap::new()))
    }

    /// Learn every model's window from a raw `result` payload.
    ///
    /// Entries for models the turn merely touched (the CLI bills a background
    /// Haiku call on essentially every turn) are recorded too — they are just
    /// as authoritative, and keying by model id keeps them from being mistaken
    /// for the session's own window.
    pub(super) fn record_context_windows(&self, raw: &Value) {
        // Steady state is "every window already known", so probe under a read
        // lock and skip the write entirely — this lock is shared by every
        // session's stream reader.
        let cell = self.context_windows_cell();
        let unchanged = |guard: &HashMap<String, u64>| {
            model_usage_windows(raw).all(|(model, window)| guard.get(model) == Some(&window))
        };
        match cell.read() {
            Ok(guard) if unchanged(&guard) => return,
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(%error, "claude context-window cache poisoned; not learning windows");
                return;
            }
        }

        let mut guard = match cell.write() {
            Ok(guard) => guard,
            Err(error) => {
                tracing::warn!(%error, "claude context-window cache poisoned; not learning windows");
                return;
            }
        };
        for (model, window) in model_usage_windows(raw) {
            if guard.insert(model.to_string(), window) != Some(window) {
                tracing::debug!(%model, window, "learned Claude Code context window");
            }
        }
    }

    /// Window previously learned for `model`, if any.
    ///
    /// `model` must be a CLI fully-qualified id — a catalog id or an `init`
    /// model, not a `message_start` model. See the module docs.
    pub(super) fn learned_context_window(&self, model: &str) -> Option<u64> {
        match self.context_windows_cell().read() {
            Ok(guard) => guard.get(model).copied(),
            Err(error) => {
                tracing::warn!(%error, "claude context-window cache poisoned; window unknown");
                None
            }
        }
    }

    /// The window for `model`, preferring what the CLI actually reported over
    /// what its id implies. Single source of precedence for both the
    /// per-event resolution and the model-switch seed, which otherwise drift.
    pub(super) fn context_window_for_model_id(&self, model: &str) -> Option<u64> {
        self.learned_context_window(model)
            .or_else(|| init_model_context_window(model))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::test_support::new_test_adapter;

    #[test]
    fn records_every_model_usage_entry_and_looks_up_by_exact_id() {
        let adapter = new_test_adapter();
        adapter.record_context_windows(&json!({
            "type": "result",
            "modelUsage": {
                "claude-haiku-4-5-20251001": { "contextWindow": 200_000 },
                "claude-sonnet-5[1m]": { "contextWindow": 1_000_000 }
            }
        }));

        assert_eq!(
            adapter.learned_context_window("claude-sonnet-5[1m]"),
            Some(1_000_000)
        );
        assert_eq!(
            adapter.learned_context_window("claude-haiku-4-5-20251001"),
            Some(200_000)
        );
    }

    #[test]
    fn never_conflates_the_1m_beta_variant_with_its_bare_id() {
        let adapter = new_test_adapter();
        adapter.record_context_windows(&json!({
            "type": "result",
            "modelUsage": { "claude-opus-5[1m]": { "contextWindow": 1_000_000 } }
        }));

        // `message_start` reports the bare id for a 1M-beta turn; answering
        // from the marked entry would claim 1M for the 200k variant.
        assert_eq!(adapter.learned_context_window("claude-opus-5"), None);
    }

    #[test]
    fn ignores_events_without_model_usage_and_zero_windows() {
        let adapter = new_test_adapter();
        adapter.record_context_windows(&json!({ "type": "stream_event", "event": {} }));
        adapter.record_context_windows(&json!({
            "type": "result",
            "modelUsage": { "broken-model": { "contextWindow": 0 } }
        }));

        assert_eq!(adapter.learned_context_window("broken-model"), None);
    }

    #[test]
    fn what_the_cli_reported_outranks_what_the_id_implies() {
        // A Fable deployment provisioned below its family default: the id says
        // 1M, the CLI says otherwise, and the CLI wins.
        let adapter = new_test_adapter();
        assert_eq!(
            adapter.context_window_for_model_id("claude-fable-5"),
            Some(1_000_000)
        );

        adapter.record_context_windows(&json!({
            "type": "result",
            "modelUsage": { "claude-fable-5": { "contextWindow": 200_000 } }
        }));

        assert_eq!(
            adapter.context_window_for_model_id("claude-fable-5"),
            Some(200_000)
        );
    }
}
