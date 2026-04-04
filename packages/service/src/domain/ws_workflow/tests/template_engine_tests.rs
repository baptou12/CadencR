#[cfg(test)]
mod template_engine_tests {
    use std::collections::HashMap;
    use crate::domain::ws_workflow::template_engine::{interpolate, TemplateContext};

    fn ctx() -> TemplateContext {
        let mut phase_artifacts = HashMap::new();
        phase_artifacts.insert("prd".to_string(), "PRD output".to_string());
        phase_artifacts.insert("plan".to_string(), "Plan output".to_string());

        TemplateContext {
            feature_title: "My Feature".to_string(),
            feature_description: "Feature desc".to_string(),
            project_name: "TestProject".to_string(),
            project_path: "/tmp/test".to_string(),
            phase_name: "Build".to_string(),
            prior_artifacts: "Prior content".to_string(),
            phase_artifacts,
            date: "2025-06-15".to_string(),
        }
    }

    #[test]
    fn test_interpolate_known_variables() {
        let c = ctx();
        let tpl = "{{feature_title}} | {{feature_description}} | {{project_name}} | {{project_path}} | {{phase_name}} | {{prior_artifacts}} | {{date}}";
        let result = interpolate(tpl, &c);
        assert_eq!(
            result,
            "My Feature | Feature desc | TestProject | /tmp/test | Build | Prior content | 2025-06-15"
        );
    }

    #[test]
    fn test_interpolate_artifact_reference() {
        let c = ctx();
        let result = interpolate("See PRD: {{artifact:prd}} and Plan: {{artifact:plan}}", &c);
        assert_eq!(result, "See PRD: PRD output and Plan: Plan output");
    }

    #[test]
    fn test_interpolate_unknown_variable_preserved() {
        let c = ctx();
        let result = interpolate("{{unknown}} stays here", &c);
        assert_eq!(result, "{{unknown}} stays here");
    }

    #[test]
    fn test_interpolate_empty_template() {
        let c = ctx();
        let result = interpolate("", &c);
        assert_eq!(result, "");
    }
}
