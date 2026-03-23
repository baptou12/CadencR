pub mod models;
pub mod routes;
mod service;

pub use crate::api::context_window_for_model;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aliases_return_correct_context_window() {
        assert_eq!(context_window_for_model("opus[1m]"), 1_000_000);
        assert_eq!(context_window_for_model("sonnet[1m]"), 1_000_000);
        assert_eq!(context_window_for_model("opus"), 200_000);
        assert_eq!(context_window_for_model("sonnet"), 200_000);
        assert_eq!(context_window_for_model("haiku"), 200_000);
    }

    #[test]
    fn full_cli_model_ids_return_correct_context_window() {
        assert_eq!(context_window_for_model("claude-opus-4-6"), 1_000_000);
        assert_eq!(context_window_for_model("claude-opus-4-6-20260101"), 1_000_000);
        assert_eq!(context_window_for_model("claude-sonnet-4-6"), 1_000_000);
        assert_eq!(context_window_for_model("claude-sonnet-4-6-20260301"), 1_000_000);
    }

    #[test]
    fn older_and_unknown_models_fall_back_to_200k() {
        assert_eq!(context_window_for_model("claude-haiku-4-5-20251001"), 200_000);
        assert_eq!(context_window_for_model("claude-opus-4-5"), 200_000);
        assert_eq!(context_window_for_model("unknown-model"), 200_000);
    }
}
