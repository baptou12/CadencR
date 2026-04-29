use super::AgentType;

#[derive(Debug, Clone, Copy)]
pub(super) enum ToolKey {
    ReadPlan,
    ListPhases,
    ReadPhase,
    CreatePhase,
    UpdatePhase,
    RemovePhase,
    UpdatePlan,
    ShowPlan,
    FinalizePlan,
    MarkAgentDone,
    MarkPhaseDone,
    ReadPrd,
    CreatePrd,
    EditPrd,
    ShowPrd,
    FinalizePhases,
    ListConversations,
    ReadConversation,
}

#[derive(Debug, Clone, Copy)]
struct ToolSpec {
    key: ToolKey,
    name: &'static str,
    required_for_health: bool,
    requires_approval_elicitation: bool,
}

impl ToolSpec {
    const fn new(key: ToolKey, name: &'static str) -> Self {
        Self {
            key,
            name,
            required_for_health: false,
            requires_approval_elicitation: false,
        }
    }

    const fn required(mut self) -> Self {
        self.required_for_health = true;
        self
    }

    const fn approval(mut self) -> Self {
        self.required_for_health = true;
        self.requires_approval_elicitation = true;
        self
    }
}

pub(super) fn required_tool_names_for_agent(agent_type: AgentType) -> Vec<String> {
    tool_specs_for_agent(agent_type)
        .iter()
        .filter(|spec| spec.required_for_health)
        .map(|spec| spec.name.to_string())
        .collect()
}

pub(super) fn approval_elicitation_tool_names_for_agent(agent_type: AgentType) -> Vec<String> {
    tool_specs_for_agent(agent_type)
        .iter()
        .filter(|spec| spec.requires_approval_elicitation)
        .map(|spec| spec.name.to_string())
        .collect()
}

pub(super) fn tool_keys_for_agent(agent_type: AgentType) -> Vec<ToolKey> {
    tool_specs_for_agent(agent_type)
        .iter()
        .map(|spec| spec.key)
        .collect()
}

const PLAN_TOOL_SPECS: [ToolSpec; 10] = [
    ToolSpec::new(ToolKey::ReadPlan, "read_plan"),
    ToolSpec::new(ToolKey::ListPhases, "list_phases"),
    ToolSpec::new(ToolKey::ReadPhase, "read_phase"),
    ToolSpec::new(ToolKey::CreatePhase, "create_phase"),
    ToolSpec::new(ToolKey::UpdatePhase, "update_phase"),
    ToolSpec::new(ToolKey::RemovePhase, "remove_phase"),
    ToolSpec::new(ToolKey::UpdatePlan, "update_plan"),
    ToolSpec::new(ToolKey::ShowPlan, "show_plan").approval(),
    ToolSpec::new(ToolKey::FinalizePlan, "finalize_plan"),
    ToolSpec::new(ToolKey::MarkAgentDone, "mark_agent_done").required(),
];
const SESSION_TOOL_SPECS: [ToolSpec; 12] = [
    ToolSpec::new(ToolKey::ReadPlan, "read_plan"),
    ToolSpec::new(ToolKey::ListPhases, "list_phases"),
    ToolSpec::new(ToolKey::ReadPhase, "read_phase"),
    ToolSpec::new(ToolKey::ReadPrd, "read_prd"),
    ToolSpec::new(ToolKey::CreatePhase, "create_phase"),
    ToolSpec::new(ToolKey::UpdatePhase, "update_phase"),
    ToolSpec::new(ToolKey::RemovePhase, "remove_phase"),
    ToolSpec::new(ToolKey::UpdatePlan, "update_plan"),
    ToolSpec::new(ToolKey::ShowPlan, "show_plan").approval(),
    ToolSpec::new(ToolKey::FinalizePlan, "finalize_plan"),
    ToolSpec::new(ToolKey::MarkAgentDone, "mark_agent_done").required(),
    ToolSpec::new(ToolKey::MarkPhaseDone, "mark_phase_done"),
];
const PRD_TOOL_SPECS: [ToolSpec; 4] = [
    ToolSpec::new(ToolKey::CreatePrd, "create_prd"),
    ToolSpec::new(ToolKey::EditPrd, "edit_prd"),
    ToolSpec::new(ToolKey::ShowPrd, "show_prd").approval(),
    ToolSpec::new(ToolKey::MarkAgentDone, "mark_agent_done").required(),
];
const EXECUTE_TOOL_SPECS: [ToolSpec; 5] = [
    ToolSpec::new(ToolKey::ReadPlan, "read_plan"),
    ToolSpec::new(ToolKey::ListPhases, "list_phases"),
    ToolSpec::new(ToolKey::ReadPhase, "read_phase"),
    ToolSpec::new(ToolKey::MarkAgentDone, "mark_agent_done").required(),
    ToolSpec::new(ToolKey::MarkPhaseDone, "mark_phase_done"),
];
const REVIEW_TOOL_SPECS: [ToolSpec; 8] = [
    ToolSpec::new(ToolKey::ReadPlan, "read_plan"),
    ToolSpec::new(ToolKey::ListPhases, "list_phases"),
    ToolSpec::new(ToolKey::ReadPhase, "read_phase"),
    ToolSpec::new(ToolKey::CreatePhase, "create_phase"),
    ToolSpec::new(ToolKey::UpdatePhase, "update_phase"),
    ToolSpec::new(ToolKey::RemovePhase, "remove_phase"),
    ToolSpec::new(ToolKey::MarkAgentDone, "mark_agent_done").required(),
    ToolSpec::new(ToolKey::FinalizePhases, "finalize_phases"),
];
const QA_TOOL_SPECS: [ToolSpec; 9] = [
    ToolSpec::new(ToolKey::ReadPlan, "read_plan"),
    ToolSpec::new(ToolKey::ListPhases, "list_phases"),
    ToolSpec::new(ToolKey::ReadPhase, "read_phase"),
    ToolSpec::new(ToolKey::CreatePhase, "create_phase"),
    ToolSpec::new(ToolKey::UpdatePhase, "update_phase"),
    ToolSpec::new(ToolKey::RemovePhase, "remove_phase"),
    ToolSpec::new(ToolKey::MarkPhaseDone, "mark_phase_done"),
    ToolSpec::new(ToolKey::MarkAgentDone, "mark_agent_done").required(),
    ToolSpec::new(ToolKey::FinalizePhases, "finalize_phases"),
];
const RETRO_TOOL_SPECS: [ToolSpec; 7] = [
    ToolSpec::new(ToolKey::ReadPlan, "read_plan"),
    ToolSpec::new(ToolKey::ListPhases, "list_phases"),
    ToolSpec::new(ToolKey::ReadPhase, "read_phase"),
    ToolSpec::new(ToolKey::ReadPrd, "read_prd"),
    ToolSpec::new(ToolKey::ListConversations, "list_conversations"),
    ToolSpec::new(ToolKey::ReadConversation, "read_conversation"),
    ToolSpec::new(ToolKey::MarkAgentDone, "mark_agent_done").required(),
];

fn tool_specs_for_agent(agent_type: AgentType) -> &'static [ToolSpec] {
    match agent_type {
        AgentType::Plan => &PLAN_TOOL_SPECS,
        AgentType::Session => &SESSION_TOOL_SPECS,
        AgentType::Prd => &PRD_TOOL_SPECS,
        AgentType::Execute => &EXECUTE_TOOL_SPECS,
        AgentType::Review | AgentType::Risk => &REVIEW_TOOL_SPECS,
        AgentType::Qa => &QA_TOOL_SPECS,
        AgentType::Retro => &RETRO_TOOL_SPECS,
    }
}
