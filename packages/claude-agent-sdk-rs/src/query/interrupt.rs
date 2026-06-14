//! Interrupt handling for [`Query`](super::query_struct::Query).

use tokio::sync::oneshot;
use tokio::time::{sleep, timeout, Duration};

use crate::error::SdkError;

use super::query_struct::Query;
use super::turn_state::TurnState;

const INTERRUPT_TURN_COMPLETE_TIMEOUT: Duration = Duration::from_secs(10);
const INTERRUPT_TURN_COMPLETE_POLL_INTERVAL: Duration = Duration::from_millis(10);

impl Query {
    /// Interrupt the agent and wait until the CLI reports the interrupted turn
    /// as complete. This keeps a replayed steering prompt from being written
    /// while Claude Code is still winding down the old turn.
    pub async fn interrupt(&self) -> Result<(), SdkError> {
        let (ack_tx, ack_rx) = oneshot::channel();
        self.interrupt_tx
            .send(ack_tx)
            .await
            .map_err(|_| SdkError::InputClosed)?;
        ack_rx.await.map_err(|_| SdkError::InputClosed)??;
        self.wait_for_interrupted_turn_complete().await
    }

    async fn wait_for_interrupted_turn_complete(&self) -> Result<(), SdkError> {
        timeout(INTERRUPT_TURN_COMPLETE_TIMEOUT, async {
            loop {
                if matches!(self.turn_state().await, TurnState::TurnComplete { .. }) {
                    return;
                }
                sleep(INTERRUPT_TURN_COMPLETE_POLL_INTERVAL).await;
            }
        })
        .await
        .map_err(|_| SdkError::Timeout)
    }
}
