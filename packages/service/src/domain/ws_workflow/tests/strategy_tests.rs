#[cfg(test)]
mod strategy_tests {
    use crate::domain::mcp::servers::AgentType;
    use crate::domain::workflow::strategies::custom_workflow::CustomWorkflowStrategy;
    use crate::domain::workflow::strategies::WorkflowStrategy;

    #[test]
    fn test_agent_type_for_item_from_config() {
        let strategy = CustomWorkflowStrategy { workflow_definition_id: 1 };

        // Config-driven: explicit agent_type in config takes precedence
        let exec_config = r#"{"agent_type": "execute"}"#;
        let wf_config = r#"{"agent_type": "workflow"}"#;

        assert!(matches!(strategy.agent_type_for_item("plan", Some(exec_config)), Ok(AgentType::Execute)));
        assert!(matches!(strategy.agent_type_for_item("build", Some(wf_config)), Ok(AgentType::Workflow)));

        // Fallback: no config defaults to Workflow
        assert!(matches!(strategy.agent_type_for_item("implement", None), Ok(AgentType::Workflow)));
        assert!(matches!(strategy.agent_type_for_item("build", None), Ok(AgentType::Workflow)));
        assert!(matches!(strategy.agent_type_for_item("plan", None), Ok(AgentType::Workflow)));
    }
}
