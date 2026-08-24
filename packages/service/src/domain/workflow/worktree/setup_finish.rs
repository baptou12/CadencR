//! Atomic terminal persistence and ordered setup completion events.

use sqlx::SqlitePool;

use super::setup_events::{send_error, send_ready};
use super::setup_state::{persist_setup_state, SetupState};
use crate::domain::features::run_registry::FeatureRunPermit;
use crate::domain::workflow::ws_sender::WsSender;

pub(super) async fn finish_error(
    write_pool: &SqlitePool,
    feature_id: i64,
    sender: &WsSender,
    permit: Option<FeatureRunPermit>,
    error: &str,
    log: &str,
    prior_persistence_error: Option<&str>,
) {
    let persistence =
        persist_setup_state(write_pool, feature_id, SetupState::Error { error, log }).await;
    let display_error = match persistence {
        Ok(()) => error.to_string(),
        Err(final_error) => match prior_persistence_error {
            Some(prior_error) => format!(
                "{error}. Setup output could not be persisted ({prior_error}); final state persistence also failed ({final_error})"
            ),
            None => format!("{error}. Final setup state could not be persisted: {final_error}"),
        },
    };
    let emit = || send_error(feature_id, sender, &display_error, log);
    if let Some(permit) = permit {
        permit.finish(emit);
    } else {
        emit();
    }
}

pub(super) async fn finish_ready(
    write_pool: &SqlitePool,
    feature_id: i64,
    sender: &WsSender,
    permit: FeatureRunPermit,
    log: &str,
    prior_persistence_error: Option<&str>,
) {
    if let Err(error) = persist_setup_state(write_pool, feature_id, SetupState::Ready { log }).await
    {
        finish_error(
            write_pool,
            feature_id,
            sender,
            Some(permit),
            &error,
            log,
            prior_persistence_error,
        )
        .await;
        return;
    }
    permit.finish(|| send_ready(feature_id, sender, log));
}
