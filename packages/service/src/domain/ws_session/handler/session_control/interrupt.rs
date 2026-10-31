use crate::app_state::AppState;
use crate::domain::agents::adapter::{RuntimeError, RuntimeSessionHandle};

/// Complete a user-requested stop whose generation was marked before any
/// provider action (including a gate denial that may itself end the turn).
pub(in super::super) async fn finish_interruption(
    result: Result<(), RuntimeError>,
    query: &RuntimeSessionHandle,
    app_state: &AppState,
    session_id: i64,
    generation: Option<u64>,
) -> Result<(), RuntimeError> {
    if let Err(error) = result {
        if let Some(generation) = generation {
            if !app_state
                .active_turns
                .clear_interruption(session_id, generation, query)
                .await
            {
                // Some providers close the control channel while stopping. The
                // reader consumed the marker, so the requested stop succeeded.
                tracing::info!(session_id, %error, "interrupt control ended after the runtime had already stopped");
                return Ok(());
            }
        }
        return Err(error);
    }
    Ok(())
}
