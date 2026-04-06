use crate::domain::mcp::servers::AgentType;
use crate::domain::workflow::engine::*;

#[test]
fn test_agent_slot_agent_type_str() {
    assert_eq!(AgentSlot::Plan.agent_type_str(), Some("plan"));
    assert_eq!(AgentSlot::Prd.agent_type_str(), Some("prd"));
    assert_eq!(AgentSlot::Session(1).agent_type_str(), Some("session"));
    assert_eq!(AgentSlot::Refine.agent_type_str(), Some("refine"));
    assert_eq!(AgentSlot::ReviewFixer(1).agent_type_str(), Some("review-fixer"));
    assert_eq!(AgentSlot::QueueItem(42).agent_type_str(), None);
}

#[test]
fn test_agent_type_str_to_slot_mapping() {
    assert_eq!(agent_type_str_to_slot("plan", 0), Some(AgentSlot::Plan));
    assert_eq!(agent_type_str_to_slot("prd", 0), Some(AgentSlot::Prd));
    assert_eq!(agent_type_str_to_slot("session", 5), Some(AgentSlot::Session(5)));
    assert_eq!(agent_type_str_to_slot("refine", 0), Some(AgentSlot::Refine));
    assert_eq!(agent_type_str_to_slot("review-fixer", 3), Some(AgentSlot::ReviewFixer(3)));
    assert_eq!(agent_type_str_to_slot("review_fixer", 3), Some(AgentSlot::ReviewFixer(3)));
    assert_eq!(agent_type_str_to_slot("execute", 0), None);
    assert_eq!(agent_type_str_to_slot("", 0), None);
}

#[test]
fn test_agent_slot_roundtrip_via_legacy_id() {
    for slot in &[AgentSlot::Plan, AgentSlot::Prd, AgentSlot::Refine] {
        let id = slot.as_legacy_id();
        let back = AgentSlot::from(id);
        assert_eq!(&back, slot);
    }
    assert_eq!(AgentSlot::from(-3), AgentSlot::Session(0));
    assert_eq!(AgentSlot::from(-5), AgentSlot::ReviewFixer(0));
    assert_eq!(AgentSlot::from(42), AgentSlot::QueueItem(42));
}

#[test]
fn test_agent_slot_sdk_agent_type() {
    assert!(matches!(AgentSlot::Plan.sdk_agent_type(), Some(AgentType::Plan)));
    assert!(matches!(AgentSlot::Refine.sdk_agent_type(), Some(AgentType::Plan)));
    assert!(matches!(AgentSlot::Prd.sdk_agent_type(), Some(AgentType::Prd)));
    assert!(matches!(AgentSlot::Session(1).sdk_agent_type(), Some(AgentType::Session)));
    assert!(matches!(AgentSlot::ReviewFixer(1).sdk_agent_type(), Some(AgentType::Execute)));
    assert!(AgentSlot::QueueItem(42).sdk_agent_type().is_none());
}

#[test]
fn test_agent_slot_system_prompt() {
    assert!(AgentSlot::Plan.system_prompt().is_some());
    assert!(AgentSlot::Prd.system_prompt().is_some());
    assert!(AgentSlot::Session(1).system_prompt().is_some());
    assert!(AgentSlot::Refine.system_prompt().is_some());
    assert!(AgentSlot::ReviewFixer(1).system_prompt().is_none());
    assert!(AgentSlot::QueueItem(42).system_prompt().is_none());
}

#[test]
fn test_agent_slot_display() {
    assert_eq!(format!("{}", AgentSlot::Plan), "plan");
    assert_eq!(format!("{}", AgentSlot::Session(42)), "session(42)");
    assert_eq!(format!("{}", AgentSlot::QueueItem(42)), "queue_item(42)");
}

#[test]
fn test_agent_slot_is_singleton() {
    assert!(AgentSlot::Plan.is_singleton());
    assert!(AgentSlot::Prd.is_singleton());
    assert!(AgentSlot::Refine.is_singleton());
    assert!(!AgentSlot::Session(1).is_singleton());
    assert!(!AgentSlot::Risk(1).is_singleton());
    assert!(!AgentSlot::Retro(1).is_singleton());
    assert!(!AgentSlot::ReviewFixer(1).is_singleton());
    assert!(!AgentSlot::QueueItem(1).is_singleton());
}

#[test]
fn test_multi_instance_slots_are_unique_keys() {
    use std::collections::HashSet;
    let mut set = HashSet::new();
    set.insert(AgentSlot::Session(1));
    set.insert(AgentSlot::Session(2));
    set.insert(AgentSlot::Session(3));
    assert_eq!(set.len(), 3, "each Session with different id should be a unique key");

    set.clear();
    set.insert(AgentSlot::Plan);
    set.insert(AgentSlot::Plan);
    assert_eq!(set.len(), 1);
}

#[test]
fn test_agent_slot_serde_roundtrip() {
    let slot = AgentSlot::Session(42);
    let json = serde_json::to_value(&slot).unwrap();
    assert_eq!(json["type"], "session");
    assert_eq!(json["id"], 42);
    let back: AgentSlot = serde_json::from_value(json).unwrap();
    assert_eq!(back, AgentSlot::Session(42));

    let plan_json = serde_json::to_value(&AgentSlot::Plan).unwrap();
    assert_eq!(plan_json["type"], "plan");
    assert!(plan_json.get("id").is_none());
}

#[test]
fn test_agent_type_str_to_slot_risk() {
    assert_eq!(agent_type_str_to_slot("risk", 1), Some(AgentSlot::Risk(1)));
}

#[test]
fn test_agent_type_str_to_slot_retro() {
    assert_eq!(agent_type_str_to_slot("retro", 1), Some(AgentSlot::Retro(1)));
}
