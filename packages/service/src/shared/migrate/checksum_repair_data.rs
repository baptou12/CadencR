pub(super) const REMOVE_WS_FEATURE_VERSION: i64 = 20260514123657;

pub(super) const OLD_REMOVE_WS_FEATURE_CHECKSUMS: [[u8; 48]; 2] = [
    [
        0x72, 0xf1, 0x8f, 0x5d, 0x02, 0x95, 0xc0, 0x82, 0xa6, 0xad, 0x46, 0xbf, 0xf3, 0x11, 0x0a,
        0x9d, 0xa6, 0xd2, 0xdf, 0x49, 0x51, 0x01, 0xb7, 0x95, 0x37, 0x50, 0xc9, 0x99, 0x8c, 0x47,
        0x72, 0x82, 0x32, 0xbf, 0xea, 0xc4, 0x1e, 0xb1, 0x7c, 0x03, 0x74, 0xb7, 0xec, 0x79, 0x29,
        0xb2, 0x1b, 0x85,
    ],
    [
        0x4b, 0x97, 0xc5, 0xbe, 0xbe, 0xc0, 0x78, 0x0a, 0x72, 0x38, 0x1c, 0xf6, 0x88, 0xd0, 0xf3,
        0xde, 0x5e, 0x73, 0xa3, 0xad, 0x34, 0xa6, 0x1e, 0x46, 0x82, 0x00, 0xfc, 0x82, 0x9a, 0x2b,
        0xbd, 0xdd, 0xe3, 0x54, 0xdc, 0xd7, 0x91, 0xb1, 0x62, 0xa0, 0x11, 0xa1, 0x2c, 0xf8, 0x9b,
        0x95, 0xbe, 0x9e,
    ],
];

pub(super) const REMOVED_FEATURE_COLUMNS: &[&str] = &[
    "model_plan",
    "model_brainstorm",
    "model_execute",
    "model_risk",
    "model_review",
    "model_prd",
    "model_review-fixer",
    "model_retro",
    "model_qa",
    "prd",
    "workflow_step",
    "workflow_config",
    "workflow_status",
    "model_workflow",
    "agent_runtime_plan",
    "agent_runtime_prd",
    "agent_runtime_execute",
    "agent_runtime_risk",
    "agent_runtime_review",
    "agent_runtime_review-fixer",
    "agent_runtime_retro",
    "agent_runtime_qa",
    "agent_autonomy",
    "parallel_execution",
];

pub(super) const REMOVED_PROJECT_COLUMNS: &[&str] = &[
    "model_plan",
    "model_brainstorm",
    "model_execute",
    "model_risk",
    "model_review",
    "model_review-fixer",
    "model_retro",
    "model_prd",
    "model_qa",
    "model_workflow",
    "agent_runtime_plan",
    "agent_runtime_prd",
    "agent_runtime_execute",
    "agent_runtime_risk",
    "agent_runtime_review",
    "agent_runtime_review-fixer",
    "agent_runtime_retro",
    "agent_runtime_qa",
    "agent_autonomy",
    "parallel_execution",
    "qa_prompt",
];

pub(super) const REMOVED_AGENT_SESSION_COLUMNS: &[&str] = &[
    "pending_plan_approval",
    "pending_prd_approval",
    "plan_approval_result",
    "prd_approval_result",
    "run_id",
    "phase_id",
    "question_answer_result",
];

pub(super) const LEGACY_SETTING_KEYS: &[&str] = &[
    "model_plan",
    "model_brainstorm",
    "model_execute",
    "model_risk",
    "model_review",
    "model_prd",
    "model_review-fixer",
    "model_retro",
    "model_qa",
    "model_workflow",
    "agent_runtime_plan",
    "agent_runtime_prd",
    "agent_runtime_execute",
    "agent_runtime_risk",
    "agent_runtime_review",
    "agent_runtime_review-fixer",
    "agent_runtime_retro",
    "agent_runtime_qa",
    "agent_autonomy",
    "parallel_execution",
    "qa_prompt",
];

pub(super) const FEATURE_STATUS_TRIGGERS: &[&str] = &[
    "features_status_insert_check",
    "features_status_insert_normalize",
    "features_status_update_check",
    "features_status_update_normalize",
];
