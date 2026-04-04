use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct Feature {
    pub id: i64,
    pub project_id: i64,
    pub title: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub status: String,
    pub prd: Option<String>,
    pub workflow_step: Option<String>,
    pub workflow_config: Option<String>,
    pub model_plan: Option<String>,
    pub model_prd: Option<String>,
    pub model_execute: Option<String>,
    pub model_risk: Option<String>,
    pub model_review: Option<String>,
    #[serde(rename = "model_review-fixer")]
    pub model_review_fixer: Option<String>,
    pub model_session: Option<String>,
    pub model_qa: Option<String>,
    pub model_retro: Option<String>,
    pub agent_autonomy: Option<String>,
    pub parallel_execution: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateFeatureRequest {
    pub project_id: i64,
    pub title: Option<String>,
    #[serde(rename = "type")]
    pub type_: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateStatusRequest {
    pub status: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateTitleRequest {
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, ToSchema)]
pub struct Plan {
    pub id: i64,
    pub feature_id: i64,
    pub title: Option<String>,
    pub status: Option<String>,
    pub summary: Option<String>,
    pub context: Option<String>,
    pub clarifications: Option<String>,
    pub completion_conditions: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, ToSchema)]
pub struct Phase {
    pub id: i64,
    pub plan_id: i64,
    pub step_number: i64,
    pub title: String,
    pub status: String,
    pub complexity: Option<i64>,
    pub commit_message: Option<String>,
    pub prompt: Option<String>,
    pub phase_type: Option<String>,
    pub implementation_notes: Option<String>,
    pub deviations: Option<String>,
    pub order_index: Option<i64>,
    pub depends_on: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PlanWithPhases {
    #[serde(flatten)]
    pub plan: Plan,
    pub phases: Vec<Phase>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlanProgress {
    pub total: i64,
    pub done: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PrdResponse {
    pub prd: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IsEmptyResponse {
    pub empty: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct WorkingDirResponse {
    pub path: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateFeatureResponse {
    pub id: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FeatureSetting {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetFeatureSettingRequest {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FeatureModelSettings {
    pub plan: String,
    pub prd: String,
    pub execute: String,
    pub risk: String,
    pub review: String,
    #[serde(rename = "review-fixer")]
    pub review_fixer: String,
    pub session: String,
    pub qa: String,
    pub retro: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetFeatureModelSettingRequest {
    pub model_type: String,
    pub model: String,
}

/// Supported workflow types. Each maps to a different orchestration strategy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowType {
    FeatureBuild,
    Custom,
}

impl WorkflowType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::FeatureBuild => "feature_build",
            Self::Custom => "custom",
        }
    }
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "feature_build" => Ok(Self::FeatureBuild),
            "custom" => Ok(Self::Custom),
            _ => Err(format!("Unknown workflow type: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct QueueItem {
    pub id: i64,
    pub feature_id: i64,
    pub workflow_type: String,
    pub item_type: String,
    pub phase_id: Option<i64>,
    pub status: String,
    pub order_index: i64,
    pub group_index: Option<i64>,
    pub config: Option<String>,
    pub agent_session_id: Option<i64>,
    pub result: Option<String>,
    pub created_at: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub pid: Option<i64>,
    pub max_retries: i64,
    pub retry_count: i64,
    #[sqlx(default)]
    pub phase_title: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExternalApp {
    Terminal,
    Zed,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct OpenExternalRequest {
    pub app: ExternalApp,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OpenExternalResponse {
    pub success: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct OverridePhaseStatusRequest {
    pub status: String,
}

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, ToSchema)]
pub struct SnapshotQueueItem {
    pub id: i64,
    pub item_type: String,
    pub phase_id: Option<i64>,
    pub phase_title: Option<String>,
    pub status: String,
    pub order_index: i64,
    pub group_index: Option<i64>,
    pub agent_session_id: Option<i64>,
    pub result: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct AgentSessionSummary {
    pub id: i64,
    pub agent_type: String,
    pub status: String,
    pub queue_item_id: Option<i64>,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub claude_session_id: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub context_window: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PlanSnapshot {
    pub id: i64,
    pub status: String,
    pub phases: Vec<Phase>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct WorktreeSnapshot {
    pub path: Option<String>,
    pub branch: Option<String>,
    pub status: String,
    pub setup_log: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FeatureSnapshotResponse {
    pub workflow_status: String,
    pub queue: Vec<SnapshotQueueItem>,
    pub agent_sessions: Vec<AgentSessionSummary>,
    pub plan: Option<PlanSnapshot>,
    pub worktree: Option<WorktreeSnapshot>,
    pub autonomy_level: u8,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feature_serde_roundtrip() {
        let feature = Feature {
            id: 1,
            project_id: 2,
            title: "Test Feature".to_string(),
            type_: "ws-feature".to_string(),
            status: "active".to_string(),
            prd: Some("prd content".to_string()),
            workflow_step: Some("step1".to_string()),
            workflow_config: Some("{}".to_string()),
            model_plan: Some("claude-3".to_string()),
            model_prd: Some("claude-prd".to_string()),
            model_execute: Some("claude-exec".to_string()),
            model_risk: Some("claude-risk".to_string()),
            model_review: Some("claude-review".to_string()),
            model_review_fixer: Some("claude-fixer".to_string()),
            model_session: Some("claude-session".to_string()),
            model_qa: Some("claude-qa".to_string()),
            model_retro: Some("claude-retro".to_string()),
            agent_autonomy: Some("full".to_string()),
            parallel_execution: Some("true".to_string()),
            created_at: "2024-01-01T00:00:00".to_string(),
        };

        let json = serde_json::to_string(&feature).unwrap();
        // Verify renamed fields
        assert!(json.contains(r#""type""#));
        assert!(json.contains(r#""model_review-fixer""#));

        let deserialized: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized["type"], "ws-feature");
        assert_eq!(deserialized["model_review-fixer"], "claude-fixer");
        assert_eq!(deserialized["title"], "Test Feature");
    }

    #[test]
    fn test_plan_serde_roundtrip() {
        let plan = Plan {
            id: 1,
            feature_id: 2,
            title: Some("My Plan".to_string()),
            status: Some("active".to_string()),
            summary: Some("summary text".to_string()),
            context: Some("context text".to_string()),
            clarifications: Some("[]".to_string()),
            completion_conditions: Some("done when done".to_string()),
            created_at: "2024-01-01T00:00:00".to_string(),
        };

        let json = serde_json::to_string(&plan).unwrap();
        let back: Plan = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, plan.id);
        assert_eq!(back.title, plan.title);
        assert_eq!(back.status, plan.status);
    }

    #[test]
    fn test_phase_serde_roundtrip() {
        let phase = Phase {
            id: 10,
            plan_id: 1,
            step_number: 2,
            title: "Phase Title".to_string(),
            status: "pending".to_string(),
            complexity: Some(3),
            commit_message: Some("fix: something".to_string()),
            prompt: Some("do this".to_string()),
            phase_type: Some("implementation".to_string()),
            implementation_notes: None,
            deviations: None,
            order_index: Some(0),
            depends_on: None,
        };

        let json = serde_json::to_string(&phase).unwrap();
        let back: Phase = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, phase.id);
        assert_eq!(back.title, phase.title);
        assert_eq!(back.complexity, phase.complexity);
    }

    #[test]
    fn test_plan_with_phases_serde_roundtrip() {
        let plan = Plan {
            id: 1,
            feature_id: 2,
            title: Some("Plan".to_string()),
            status: Some("active".to_string()),
            summary: None,
            context: None,
            clarifications: None,
            completion_conditions: None,
            created_at: "2024-01-01T00:00:00".to_string(),
        };
        let phases = vec![
            Phase {
                id: 1,
                plan_id: 1,
                step_number: 1,
                title: "Phase 1".to_string(),
                status: "pending".to_string(),
                complexity: None,
                commit_message: None,
                prompt: None,
                phase_type: None,
                implementation_notes: None,
                deviations: None,
                order_index: Some(0),
                depends_on: None,
            },
        ];
        let pwp = PlanWithPhases { plan, phases };

        let json = serde_json::to_string(&pwp).unwrap();
        let val: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(val["id"], 1);
        assert_eq!(val["phases"][0]["title"], "Phase 1");
    }

    #[test]
    fn test_plan_progress_serde_roundtrip() {
        let progress = PlanProgress { total: 5, done: 3 };
        let json = serde_json::to_string(&progress).unwrap();
        let back: PlanProgress = serde_json::from_str(&json).unwrap();
        assert_eq!(back.total, 5);
        assert_eq!(back.done, 3);
    }

    #[test]
    fn test_feature_setting_serde_roundtrip() {
        let setting = FeatureSetting {
            key: "instructions".to_string(),
            value: "do this".to_string(),
        };
        let json = serde_json::to_string(&setting).unwrap();
        let back: FeatureSetting = serde_json::from_str(&json).unwrap();
        assert_eq!(back.key, "instructions");
        assert_eq!(back.value, "do this");
    }

    #[test]
    fn test_feature_model_settings_serde_roundtrip() {
        let settings = FeatureModelSettings {
            plan: "claude-plan".to_string(),
            prd: "claude-prd".to_string(),
            execute: "claude-exec".to_string(),
            risk: "claude-risk".to_string(),
            review: "claude-review".to_string(),
            review_fixer: "claude-fixer".to_string(),
            session: "claude-session".to_string(),
            qa: "claude-qa".to_string(),
            retro: "claude-retro".to_string(),
        };

        let json = serde_json::to_string(&settings).unwrap();
        assert!(json.contains(r#""review-fixer""#));

        let val: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(val["review-fixer"], "claude-fixer");
        assert_eq!(val["plan"], "claude-plan");
    }

    #[test]
    fn test_create_feature_request_serde() {
        let json = r#"{"project_id": 1, "title": "My Feature", "type": "ws-feature"}"#;
        let req: CreateFeatureRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.project_id, 1);
        assert_eq!(req.title.as_deref(), Some("My Feature"));
        assert_eq!(req.type_.as_deref(), Some("ws-feature"));
    }

    #[test]
    fn test_update_status_request_serde() {
        let json = r#"{"status": "archived"}"#;
        let req: UpdateStatusRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.status, "archived");
    }

    #[test]
    fn test_update_title_request_serde() {
        let json = r#"{"title": "New Title"}"#;
        let req: UpdateTitleRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.title, "New Title");
    }

    #[test]
    fn test_set_feature_setting_request_serde() {
        let json = r#"{"key": "instructions", "value": "do this"}"#;
        let req: SetFeatureSettingRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.key, "instructions");
        assert_eq!(req.value, "do this");
    }

    #[test]
    fn test_set_feature_model_setting_request_serde() {
        let json = r#"{"model_type": "plan", "model": "claude-3"}"#;
        let req: SetFeatureModelSettingRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.model_type, "plan");
        assert_eq!(req.model, "claude-3");
    }

    #[test]
    fn test_override_phase_status_request_serde() {
        let json = r#"{"status": "completed"}"#;
        let req: OverridePhaseStatusRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.status, "completed");
    }

    #[test]
    fn test_workflow_type_as_str() {
        assert_eq!(WorkflowType::FeatureBuild.as_str(), "feature_build");
    }

    #[test]
    fn test_workflow_type_from_str_valid() {
        let wt = WorkflowType::from_str("feature_build").unwrap();
        assert_eq!(wt, WorkflowType::FeatureBuild);
    }

    #[test]
    fn test_workflow_type_from_str_invalid() {
        let result = WorkflowType::from_str("unknown");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown workflow type"));
    }

    #[test]
    fn test_workflow_type_serde_roundtrip() {
        let wt = WorkflowType::FeatureBuild;
        let json = serde_json::to_string(&wt).unwrap();
        assert_eq!(json, r#""feature_build""#);
        let back: WorkflowType = serde_json::from_str(&json).unwrap();
        assert_eq!(back, WorkflowType::FeatureBuild);
    }

    #[test]
    fn test_workflow_type_deserialize_snake_case() {
        let back: WorkflowType = serde_json::from_str(r#""feature_build""#).unwrap();
        assert_eq!(back, WorkflowType::FeatureBuild);
    }

    #[test]
    fn test_workflow_type_clone_and_eq() {
        let wt = WorkflowType::FeatureBuild;
        let cloned = wt.clone();
        assert_eq!(wt, cloned);
    }

    #[test]
    fn test_queue_item_serde_roundtrip() {
        let item = QueueItem {
            id: 1,
            feature_id: 10,
            workflow_type: "feature_build".to_string(),
            item_type: "execute".to_string(),
            phase_id: Some(5),
            status: "ready".to_string(),
            order_index: 0,
            group_index: Some(1),
            config: Some(r#"{"key":"val"}"#.to_string()),
            agent_session_id: Some(42),
            result: None,
            created_at: Some("2024-01-01T00:00:00".to_string()),
            started_at: None,
            ended_at: None,
            pid: Some(12345),
            max_retries: 1,
            retry_count: 0,
            phase_title: None,
        };

        let json = serde_json::to_string(&item).unwrap();
        let back: QueueItem = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, 1);
        assert_eq!(back.feature_id, 10);
        assert_eq!(back.workflow_type, "feature_build");
        assert_eq!(back.item_type, "execute");
        assert_eq!(back.phase_id, Some(5));
        assert_eq!(back.status, "ready");
        assert_eq!(back.order_index, 0);
        assert_eq!(back.group_index, Some(1));
        assert_eq!(back.config.as_deref(), Some(r#"{"key":"val"}"#));
        assert_eq!(back.agent_session_id, Some(42));
        assert!(back.result.is_none());
        assert_eq!(back.pid, Some(12345));
        assert_eq!(back.max_retries, 1);
        assert_eq!(back.retry_count, 0);
    }

    #[test]
    fn test_queue_item_serde_all_none_optionals() {
        let item = QueueItem {
            id: 1,
            feature_id: 10,
            workflow_type: "feature_build".to_string(),
            item_type: "prd".to_string(),
            phase_id: None,
            status: "blocked".to_string(),
            order_index: 0,
            group_index: None,
            config: None,
            agent_session_id: None,
            result: None,
            created_at: None,
            started_at: None,
            ended_at: None,
            pid: None,
            max_retries: 1,
            retry_count: 0,
            phase_title: None,
        };

        let json = serde_json::to_string(&item).unwrap();
        let back: QueueItem = serde_json::from_str(&json).unwrap();
        assert!(back.phase_id.is_none());
        assert!(back.group_index.is_none());
        assert!(back.config.is_none());
        assert!(back.pid.is_none());
    }

    #[test]
    fn test_create_feature_request_minimal() {
        let json = r#"{"project_id": 1}"#;
        let req: CreateFeatureRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.project_id, 1);
        assert!(req.title.is_none());
        assert!(req.type_.is_none());
    }

    #[test]
    fn test_prd_response_serde() {
        let resp = PrdResponse { prd: Some("content".to_string()) };
        let json = serde_json::to_string(&resp).unwrap();
        let val: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(val["prd"], "content");

        let resp_none = PrdResponse { prd: None };
        let json_none = serde_json::to_string(&resp_none).unwrap();
        let val_none: serde_json::Value = serde_json::from_str(&json_none).unwrap();
        assert!(val_none["prd"].is_null());
    }

    #[test]
    fn test_is_empty_response_serde() {
        let resp = IsEmptyResponse { empty: true };
        let json = serde_json::to_string(&resp).unwrap();
        let val: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(val["empty"], true);
    }

    #[test]
    fn test_create_feature_response_serde() {
        let resp = CreateFeatureResponse { id: 42 };
        let json = serde_json::to_string(&resp).unwrap();
        let val: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(val["id"], 42);
    }

    #[test]
    fn test_working_dir_response_serde() {
        let resp = WorkingDirResponse { path: Some("/tmp/dir".to_string()) };
        let json = serde_json::to_string(&resp).unwrap();
        let val: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(val["path"], "/tmp/dir");
    }
}
