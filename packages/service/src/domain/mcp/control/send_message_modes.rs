use crate::error::AppError;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum DeliveryMode {
    SteerCurrentTurn,
    NextTurn,
    RejectIfActive,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ReplyMode {
    None,
    OnTurnEnd,
}

pub(super) fn reply_mode(value: Option<&str>) -> Result<ReplyMode, AppError> {
    match value.unwrap_or("none") {
        "none" => Ok(ReplyMode::None),
        "on_turn_end" => Ok(ReplyMode::OnTurnEnd),
        other => Err(AppError::BadRequest(format!(
            "unsupported reply mode '{other}'"
        ))),
    }
}

pub(super) fn delivery_mode(value: Option<&str>) -> Result<DeliveryMode, String> {
    match value.unwrap_or("steer_current_turn") {
        "steer_current_turn" | "send_now" => Ok(DeliveryMode::SteerCurrentTurn),
        "next_turn" | "queue_if_busy" => Ok(DeliveryMode::NextTurn),
        "reject_if_active" | "reject_if_busy" => Ok(DeliveryMode::RejectIfActive),
        other => Err(format!("unsupported delivery mode '{other}'")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delivery_defaults_to_steering_and_requires_explicit_queueing() {
        assert!(matches!(
            delivery_mode(None),
            Ok(DeliveryMode::SteerCurrentTurn)
        ));
        assert!(matches!(
            delivery_mode(Some("next_turn")),
            Ok(DeliveryMode::NextTurn)
        ));
        assert!(matches!(
            delivery_mode(Some("queue_if_busy")),
            Ok(DeliveryMode::NextTurn)
        ));
    }
}
