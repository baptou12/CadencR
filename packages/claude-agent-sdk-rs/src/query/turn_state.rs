//! `TurnState` — represents whose "turn" it is in the agent conversation.
//!
//! Driven by the reader loop in [`super::reader`] and consumed by Cadencr's
//! UI to decide what to show next.

/// Represents whose "turn" it is in the agent conversation.
///
/// This is critical for Cadencr's UI to know what to show:
/// - `AgentWorking` → show streaming output / spinner
/// - `TurnComplete` → show input box (session) or final result (non-session)
/// - `WaitingForPermission` → show approval UI
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnState {
    /// Claude is actively generating (streaming events flowing).
    AgentWorking,

    /// User's turn — CLI finished processing (`Result` message received).
    /// For session agents, user can send another message.
    /// For non-session agents, the agent is done.
    TurnComplete {
        result_subtype: String,
        is_error: bool,
    },

    /// User's turn — Claude is blocked waiting for permission/approval.
    /// The `canUseTool` callback is currently awaiting a response.
    WaitingForPermission {
        tool_name: String,
        tool_use_id: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turn_state_equality() {
        let a = TurnState::AgentWorking;
        let b = TurnState::AgentWorking;
        assert_eq!(a, b);

        let c = TurnState::TurnComplete {
            result_subtype: "success".to_string(),
            is_error: false,
        };
        let d = TurnState::TurnComplete {
            result_subtype: "success".to_string(),
            is_error: false,
        };
        assert_eq!(c, d);

        assert_ne!(a, c);
    }
}
