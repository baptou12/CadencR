//! Explicit workflow status state machine.
//!
//! Instead of deriving status from queue/session/plan state, we store it
//! directly in the `features.workflow_status` column and validate transitions.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// All possible workflow statuses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStatus {
    Idle,
    Planning,
    Prd,
    PlanApproval,
    ReadyToBuild,
    Building,
    Paused,
    Completed,
    Error,
}

impl fmt::Display for WorkflowStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            Self::Idle => "idle",
            Self::Planning => "planning",
            Self::Prd => "prd",
            Self::PlanApproval => "plan_approval",
            Self::ReadyToBuild => "ready_to_build",
            Self::Building => "building",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Error => "error",
        };
        f.write_str(s)
    }
}

impl FromStr for WorkflowStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "idle" => Ok(Self::Idle),
            "planning" => Ok(Self::Planning),
            "prd" => Ok(Self::Prd),
            "plan_approval" => Ok(Self::PlanApproval),
            "ready_to_build" => Ok(Self::ReadyToBuild),
            "building" => Ok(Self::Building),
            "paused" => Ok(Self::Paused),
            "completed" => Ok(Self::Completed),
            "error" => Ok(Self::Error),
            _ => Err(format!("Unknown workflow status: {s}")),
        }
    }
}

impl WorkflowStatus {
    /// Validate that transitioning from `self` to `to` is legal.
    /// Returns `Ok(to)` on success, or an error describing the illegal transition.
    pub fn transition(self, to: WorkflowStatus) -> Result<WorkflowStatus, String> {
        // Allow no-op transitions (same state)
        if self == to {
            return Ok(to);
        }

        let valid = match self {
            Self::Idle => matches!(to, Self::Planning | Self::Prd | Self::Building),
            Self::Planning => matches!(to, Self::PlanApproval | Self::Error | Self::Idle),
            Self::Prd => matches!(to, Self::Planning | Self::Idle | Self::Error),
            Self::PlanApproval => {
                matches!(to, Self::ReadyToBuild | Self::Planning | Self::Building)
            }
            Self::ReadyToBuild => matches!(to, Self::Building),
            Self::Building => matches!(to, Self::Paused | Self::Completed | Self::Error),
            Self::Paused => matches!(to, Self::Building | Self::Idle),
            Self::Completed => matches!(to, Self::Building | Self::Idle),
            Self::Error => matches!(to, Self::Building | Self::Idle),
        };

        if valid {
            Ok(to)
        } else {
            Err(format!("Invalid workflow transition: {self} → {to}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip() {
        for s in [
            "idle",
            "planning",
            "prd",
            "plan_approval",
            "ready_to_build",
            "building",
            "paused",
            "completed",
            "error",
        ] {
            let status: WorkflowStatus = s.parse().unwrap();
            assert_eq!(status.to_string(), s);
        }
    }

    #[test]
    fn test_valid_transitions() {
        assert!(WorkflowStatus::Idle
            .transition(WorkflowStatus::Planning)
            .is_ok());
        assert!(WorkflowStatus::Planning
            .transition(WorkflowStatus::PlanApproval)
            .is_ok());
        assert!(WorkflowStatus::PlanApproval
            .transition(WorkflowStatus::ReadyToBuild)
            .is_ok());
        assert!(WorkflowStatus::ReadyToBuild
            .transition(WorkflowStatus::Building)
            .is_ok());
        assert!(WorkflowStatus::Building
            .transition(WorkflowStatus::Completed)
            .is_ok());
        assert!(WorkflowStatus::Building
            .transition(WorkflowStatus::Paused)
            .is_ok());
        assert!(WorkflowStatus::Building
            .transition(WorkflowStatus::Error)
            .is_ok());
        assert!(WorkflowStatus::Paused
            .transition(WorkflowStatus::Building)
            .is_ok());
        assert!(WorkflowStatus::Error
            .transition(WorkflowStatus::Building)
            .is_ok());
        assert!(WorkflowStatus::Error
            .transition(WorkflowStatus::Idle)
            .is_ok());
    }

    #[test]
    fn test_invalid_transitions() {
        assert!(WorkflowStatus::Idle
            .transition(WorkflowStatus::Completed)
            .is_err());
        assert!(WorkflowStatus::Completed
            .transition(WorkflowStatus::Planning)
            .is_err());
        assert!(WorkflowStatus::ReadyToBuild
            .transition(WorkflowStatus::Idle)
            .is_err());
    }

    #[test]
    fn test_noop_transition() {
        assert!(WorkflowStatus::Building
            .transition(WorkflowStatus::Building)
            .is_ok());
    }
}
