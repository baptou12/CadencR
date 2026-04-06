use serde::{Deserialize, Serialize};

use crate::domain::mcp::servers::AgentType;
use crate::domain::workflow::prompts::Prompts;

/// Discriminated union replacing synthetic negative queue_item_id constants.
/// Pre-queue agents get named variants; real queue items carry their DB id.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(tag = "type", content = "id")]
pub enum AgentSlot {
    #[serde(rename = "queue_item")]
    QueueItem(i64),
    #[serde(rename = "plan")]
    Plan,
    #[serde(rename = "prd")]
    Prd,
    /// Session agent. Carries the DB agent_session_id so multiple concurrent
    /// sessions get unique DashMap keys.
    #[serde(rename = "session")]
    Session(i64),
    #[serde(rename = "refine")]
    Refine,
    #[serde(rename = "review-fixer")]
    ReviewFixer(i64),
    #[serde(rename = "risk")]
    Risk(i64),
    #[serde(rename = "retro")]
    Retro(i64),
}

impl AgentSlot {
    /// Backward-compat: map to the legacy synthetic negative IDs.
    pub fn as_legacy_id(&self) -> i64 {
        match self {
            AgentSlot::Plan => -1,
            AgentSlot::Prd => -2,
            AgentSlot::Session(_) => -3,
            AgentSlot::Refine => -4,
            AgentSlot::ReviewFixer(_) => -5,
            AgentSlot::Risk(_) => -6,
            AgentSlot::Retro(_) => -7,
            AgentSlot::QueueItem(id) => *id,
        }
    }

    pub fn agent_type_str(&self) -> Option<&'static str> {
        match self {
            AgentSlot::Plan => Some("plan"),
            AgentSlot::Prd => Some("prd"),
            AgentSlot::Session(_) => Some("session"),
            AgentSlot::Refine => Some("refine"),
            AgentSlot::ReviewFixer(_) => Some("review-fixer"),
            AgentSlot::Risk(_) => Some("risk"),
            AgentSlot::Retro(_) => Some("retro"),
            AgentSlot::QueueItem(_) => None,
        }
    }

    pub fn sdk_agent_type(&self) -> Option<AgentType> {
        match self {
            AgentSlot::Plan | AgentSlot::Refine => Some(AgentType::Plan),
            AgentSlot::Prd => Some(AgentType::Prd),
            AgentSlot::Session(_) => Some(AgentType::Session),
            AgentSlot::ReviewFixer(_) => Some(AgentType::Execute),
            AgentSlot::Risk(_) => Some(AgentType::Risk),
            AgentSlot::Retro(_) => Some(AgentType::Retro),
            AgentSlot::QueueItem(_) => None,
        }
    }

    /// Returns true for slot types that allow only one concurrent instance (plan, prd, refine).
    pub fn is_singleton(&self) -> bool {
        matches!(self, AgentSlot::Plan | AgentSlot::Prd | AgentSlot::Refine)
    }

    pub fn system_prompt(&self) -> Option<&'static str> {
        match self {
            AgentSlot::Plan | AgentSlot::Refine => Some(Prompts::plan()),
            AgentSlot::Prd => Some(Prompts::prd()),
            AgentSlot::Session(_) => Some(Prompts::session()),
            AgentSlot::Risk(_) => Some(Prompts::risk()),
            AgentSlot::Retro(_) => Some(Prompts::retro()),
            _ => None,
        }
    }
}

impl From<i64> for AgentSlot {
    /// Convert a legacy synthetic ID to an AgentSlot.
    /// Multi-instance types get a placeholder ID of 0 — callers should replace
    /// with the real db_session_id when available.
    fn from(id: i64) -> Self {
        match id {
            -1 => AgentSlot::Plan,
            -2 => AgentSlot::Prd,
            -3 => AgentSlot::Session(0),
            -4 => AgentSlot::Refine,
            -5 => AgentSlot::ReviewFixer(0),
            -6 => AgentSlot::Risk(0),
            -7 => AgentSlot::Retro(0),
            other => AgentSlot::QueueItem(other),
        }
    }
}

impl std::fmt::Display for AgentSlot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentSlot::Plan => write!(f, "plan"),
            AgentSlot::Prd => write!(f, "prd"),
            AgentSlot::Session(id) => write!(f, "session({})", id),
            AgentSlot::Refine => write!(f, "refine"),
            AgentSlot::ReviewFixer(id) => write!(f, "review_fixer({})", id),
            AgentSlot::Risk(id) => write!(f, "risk({})", id),
            AgentSlot::Retro(id) => write!(f, "retro({})", id),
            AgentSlot::QueueItem(id) => write!(f, "queue_item({})", id),
        }
    }
}

/// Map an agent type string to an AgentSlot.
/// `session_id` is used for multi-instance types (session, risk, retro, review-fixer).
pub fn agent_type_str_to_slot(agent_type: &str, session_id: i64) -> Option<AgentSlot> {
    match agent_type {
        "plan" => Some(AgentSlot::Plan),
        "prd" => Some(AgentSlot::Prd),
        "session" => Some(AgentSlot::Session(session_id)),
        "refine" => Some(AgentSlot::Refine),
        "review-fixer" | "review_fixer" => Some(AgentSlot::ReviewFixer(session_id)),
        "risk" => Some(AgentSlot::Risk(session_id)),
        "retro" => Some(AgentSlot::Retro(session_id)),
        _ => None,
    }
}
