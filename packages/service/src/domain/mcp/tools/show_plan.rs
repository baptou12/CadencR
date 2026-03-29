use std::sync::Arc;

use crate::domain::mcp::context::McpContext;
use crate::domain::mcp::tools::read_plan::ReadPlanTool;

/// Show the plan to the user for approval.
///
/// The actual approval blocking is handled by `canUseTool` in the engine's
/// `WorkflowPermissionBridge` — when it detects a `show_plan` tool call,
/// it emits a `plan_ready` WS event and blocks until the user approves.
/// By the time this tool executes, the plan has already been approved.
pub struct ShowPlanTool {
    pub ctx: Arc<McpContext>,
}

#[derive(sqlx::FromRow)]
struct RiskPhaseRow {
    title: String,
    prompt: Option<String>,
}

struct RiskCategory {
    label: &'static str,
    keywords: &'static [&'static str],
}

const RISK_CATEGORIES: &[RiskCategory] = &[
    RiskCategory {
        label: "touches data migration/schema changes",
        keywords: &["migration", "schema change", "alter table", "add column", "drop column"],
    },
    RiskCategory {
        label: "touches authentication/authorization",
        keywords: &["auth", "permission", "login", "token", "session", "credential"],
    },
    RiskCategory {
        label: "contains destructive operations",
        keywords: &["delete", "drop", "remove", "destroy", "truncate", "purge"],
    },
];

/// Scan phase titles and prompts for risky keywords, returning warning strings.
fn detect_plan_risks(phases: &[RiskPhaseRow]) -> Vec<String> {
    let mut warnings = Vec::new();

    for phase in phases {
        let title_lower = phase.title.to_lowercase();
        let prompt_lower = phase.prompt.as_deref().unwrap_or("").to_lowercase();
        let combined = format!("{title_lower} {prompt_lower}");

        for cat in RISK_CATEGORIES {
            if cat.keywords.iter().any(|kw| combined.contains(kw)) {
                warnings.push(format!(
                    "⚠️ Phase \"{}\" — {}",
                    phase.title, cat.label
                ));
            }
        }
    }

    warnings
}

impl ShowPlanTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self, plan_id: i64) -> Result<String, String> {
        // Read and return the plan — approval already handled by canUseTool
        let read_plan = ReadPlanTool::new(Arc::clone(&self.ctx));
        let plan_content = read_plan.call(plan_id).await?;

        // Fetch phases for risk detection
        let phases: Vec<RiskPhaseRow> = sqlx::query_as(
            "SELECT title, prompt FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
        )
        .bind(plan_id)
        .fetch_all(&self.ctx.read_pool)
        .await
        .map_err(|e| format!("Failed to fetch phases for risk detection: {e}"))?;

        let warnings = detect_plan_risks(&phases);

        if warnings.is_empty() {
            Ok(format!("Plan approved.\n\n{plan_content}"))
        } else {
            let risk_section = format!(
                "\n\n## ⚠️ Risk Warnings\nThe following phases contain potentially risky operations. Consider adding mitigation steps:\n\n{}\n\nThese warnings are informational only and do not block plan approval.",
                warnings.join("\n")
            );
            Ok(format!("Plan approved.\n\n{plan_content}{risk_section}"))
        }
    }
}
