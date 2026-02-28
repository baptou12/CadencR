/**
 * Workflow Orchestrator — drives the feature workflow (PRD → Plan → Execute → QA → Review)
 * using a centralized transition table instead of scattered advancement logic.
 */

import { getDatabase } from "../db/database";
import { getAutonomyLevel } from "./execute-agent";
import { notifyDbUpdated } from "./session-persistence";
import { resolveAgentCwd } from "./resolve-cwd";
import { transitionFeature } from "./state-transitions";

type WorkflowStep = "prd" | "plan" | "execute" | "qa" | "review" | "done";

interface WorkflowContext {
  hasPendingFixes: boolean;
}

// ---------------------------------------------------------------------------
// Transition Table — ALL workflow logic lives here
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<WorkflowStep, (ctx: WorkflowContext) => WorkflowStep> = {
  prd:     () => "plan",
  plan:    () => "execute",
  execute: () => "qa",
  qa:      (ctx) => ctx.hasPendingFixes ? "execute" : "review",
  review:  (ctx) => ctx.hasPendingFixes ? "execute" : "done",
  done:    () => "done",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initWorkflow(featureId: number, startStep: "prd" | "plan"): void {
  const db = getDatabase();
  db.prepare("UPDATE features SET workflow_step = ?, workflow_config = ? WHERE id = ?")
    .run(startStep, JSON.stringify({}), featureId);
}

/**
 * Central workflow advancement — called when any step completes.
 * Reads current step, builds context, looks up next step from transition table,
 * updates DB, and auto-runs if autonomy >= 2.
 */
export function onStepCompleted(featureId: number): void {
  const db = getDatabase();
  const feat = db.prepare("SELECT workflow_step, project_id FROM features WHERE id = ?")
    .get(featureId) as { workflow_step: string | null; project_id: number } | undefined;

  if (!feat?.workflow_step) return;

  const currentStep = feat.workflow_step as WorkflowStep;
  if (currentStep === "done") return;

  // Build context by querying for pending fix phases
  const ctx = buildWorkflowContext(featureId);

  // Look up next step
  const nextStep = TRANSITIONS[currentStep](ctx);

  if (nextStep === "done") {
    // Workflow complete
    db.prepare("UPDATE features SET workflow_step = NULL, workflow_config = NULL WHERE id = ?")
      .run(featureId);
    transitionFeature(db, featureId, "done");
    notifyDbUpdated("feature", featureId);
    return;
  }

  db.prepare("UPDATE features SET workflow_step = ? WHERE id = ?")
    .run(nextStep, featureId);
  notifyDbUpdated("feature", featureId);

  // Auto-run if autonomy >= 2
  const autonomy = getAutonomyLevel(featureId, feat.project_id);
  if (autonomy >= 2) {
    runStep(featureId, feat.project_id);
  }
}

/** Alias for backwards compatibility */
export const advanceWorkflow = onStepCompleted;

export function continueWorkflow(featureId: number): void {
  const db = getDatabase();
  const feat = db.prepare("SELECT workflow_step, project_id FROM features WHERE id = ?")
    .get(featureId) as { workflow_step: string | null; project_id: number } | undefined;
  if (!feat?.workflow_step) return;
  runStep(featureId, feat.project_id);
}

/**
 * Standalone QA→Execute chaining — called when QA finishes outside a workflow.
 * Checks for pending fix phases and auto-starts execute if autonomy >= 2.
 */
export function autoStartExecuteAfterQa(featureId: number, projectId: number): void {
  const db = getDatabase();
  const plan = db.prepare(
    "SELECT id FROM plans WHERE feature_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
  ).get(featureId) as { id: number } | undefined;
  if (!plan) return;

  const pending = db.prepare(
    "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND status = 'pending'",
  ).get(plan.id) as { cnt: number };
  if (pending.cnt === 0) return;

  const autonomy = getAutonomyLevel(featureId, projectId);
  if (autonomy >= 2) {
    const { cwd, worktreePath } = resolveAgentCwd(featureId, projectId);
    const { startExecuteAgent } = require("./execute-agent");
    try {
      startExecuteAgent({ featureId, projectId, cwd, worktreePath });
      console.log(`[workflow] Auto-started execute after standalone QA for feature ${featureId}`);
    } catch (err) {
      console.error(`[workflow] Failed to auto-start execute after QA for feature ${featureId}:`, err);
    }
  }
}

export function resumeWorkflows(): void {
  const db = getDatabase();
  const features = db.prepare(
    "SELECT id, project_id, workflow_step FROM features WHERE workflow_step IS NOT NULL",
  ).all() as { id: number; project_id: number; workflow_step: string }[];

  for (const feat of features) {
    const session = db.prepare(
      "SELECT id, status FROM agent_sessions WHERE feature_id = ? AND agent_type = ? ORDER BY id DESC LIMIT 1",
    ).get(feat.id, feat.workflow_step === "execute" ? "execute" : feat.workflow_step) as { id: number; status: string } | undefined;

    if (session?.status === "completed") {
      onStepCompleted(feat.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function buildWorkflowContext(featureId: number): WorkflowContext {
  const db = getDatabase();
  const plan = db.prepare(
    "SELECT id FROM plans WHERE feature_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
  ).get(featureId) as { id: number } | undefined;

  if (!plan) return { hasPendingFixes: false };

  const pending = db.prepare(
    "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND status = 'pending'",
  ).get(plan.id) as { cnt: number };

  return { hasPendingFixes: pending.cnt > 0 };
}

function runStep(featureId: number, projectId: number): void {
  const db = getDatabase();
  const feat = db.prepare("SELECT workflow_step FROM features WHERE id = ?")
    .get(featureId) as { workflow_step: string | null } | undefined;
  if (!feat?.workflow_step) return;

  const { cwd, worktreePath } = resolveAgentCwd(featureId, projectId);

  switch (feat.workflow_step as WorkflowStep) {
    case "prd": {
      const feature = db.prepare("SELECT prd, title FROM features WHERE id = ?")
        .get(featureId) as { prd: string | null; title: string } | undefined;
      const { startPrdAgent } = require("./agent-starters");
      startPrdAgent({ featureId, projectId, description: feature?.prd || feature?.title || "", cwd, worktreePath });
      break;
    }
    case "plan": {
      const feature = db.prepare("SELECT prd, title FROM features WHERE id = ?")
        .get(featureId) as { prd: string | null; title: string } | undefined;
      const { startPlanAgent } = require("./agent-starters");
      startPlanAgent({ featureId, projectId, description: feature?.prd || feature?.title || "", cwd, worktreePath });
      break;
    }
    case "execute": {
      const { startExecuteAgent } = require("./execute-agent");
      startExecuteAgent({ featureId, projectId, cwd, worktreePath });
      break;
    }
    case "qa": {
      const { startQaAgent } = require("./agent-starters");
      startQaAgent({ featureId, projectId, cwd, worktreePath });
      break;
    }
    case "review": {
      const { startReviewAgent } = require("./agent-starters");
      startReviewAgent({ featureId, projectId, cwd, worktreePath });
      break;
    }
  }
}
