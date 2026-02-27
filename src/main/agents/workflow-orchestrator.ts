/**
 * Workflow Orchestrator — drives the feature workflow (PRD → Plan → Execute → QA → Review)
 * as a single state machine instead of scattered completion actions.
 */

import { getDatabase } from "../db/database";
import { getAutonomyLevel } from "./execute-agent";
import { notifyDbUpdated } from "./session-persistence";

type WorkflowStep = "prd" | "plan" | "execute" | "qa" | "review";

interface WorkflowConfig {
  steps: WorkflowStep[];
}

const PRD_FIRST_STEPS: WorkflowStep[] = ["prd", "plan", "execute", "qa", "review"];
const PLAN_FIRST_STEPS: WorkflowStep[] = ["plan", "execute", "qa", "review"];

import { resolveAgentCwd } from "./resolve-cwd";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initWorkflow(featureId: number, startStep: "prd" | "plan"): void {
  const db = getDatabase();
  const steps = startStep === "prd" ? PRD_FIRST_STEPS : PLAN_FIRST_STEPS;
  const config: WorkflowConfig = { steps };
  db.prepare("UPDATE features SET workflow_step = ?, workflow_config = ? WHERE id = ?")
    .run(startStep, JSON.stringify(config), featureId);
}

export function advanceWorkflow(featureId: number): void {
  const db = getDatabase();
  const feat = db.prepare("SELECT workflow_step, workflow_config, project_id FROM features WHERE id = ?")
    .get(featureId) as { workflow_step: string | null; workflow_config: string | null; project_id: number } | undefined;

  if (!feat?.workflow_step || !feat.workflow_config) return;

  const config: WorkflowConfig = JSON.parse(feat.workflow_config);
  const currentIdx = config.steps.indexOf(feat.workflow_step as WorkflowStep);
  if (currentIdx === -1) return;

  let nextStep: WorkflowStep | null = null;

  // If QA just finished, check for pending fix phases → loop back to execute
  if (feat.workflow_step === "qa") {
    const plan = db.prepare(
      "SELECT id FROM plans WHERE feature_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
    ).get(featureId) as { id: number } | undefined;
    if (plan) {
      const pending = db.prepare(
        "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND status = 'pending'",
      ).get(plan.id) as { cnt: number };
      if (pending.cnt > 0) {
        nextStep = "execute";
      }
    }
  }

  // Normal advancement
  if (!nextStep) {
    if (currentIdx + 1 < config.steps.length) {
      nextStep = config.steps[currentIdx + 1];
    }
  }

  if (!nextStep) {
    // Workflow complete
    db.prepare("UPDATE features SET workflow_step = NULL, workflow_config = NULL WHERE id = ?")
      .run(featureId);
    // Transition feature to done
    const { transitionFeature } = require("./state-transitions");
    transitionFeature(db, featureId, "done");
    notifyDbUpdated("feature", featureId);
    return;
  }

  db.prepare("UPDATE features SET workflow_step = ? WHERE id = ?")
    .run(nextStep, featureId);
  notifyDbUpdated("feature", featureId);

  // Check autonomy — auto-run if >= 2
  const autonomy = getAutonomyLevel(featureId, feat.project_id);
  if (autonomy >= 2) {
    runStep(featureId, feat.project_id);
  }
}

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
    // Check if the current step's session is completed but workflow hasn't advanced
    const session = db.prepare(
      "SELECT id, status FROM agent_sessions WHERE feature_id = ? AND agent_type = ? ORDER BY id DESC LIMIT 1",
    ).get(feat.id, feat.workflow_step === "execute" ? "execute" : feat.workflow_step) as { id: number; status: string } | undefined;

    if (session?.status === "completed") {
      advanceWorkflow(feat.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function runStep(featureId: number, projectId: number): void {
  const db = getDatabase();
  const feat = db.prepare("SELECT workflow_step FROM features WHERE id = ?")
    .get(featureId) as { workflow_step: string | null } | undefined;
  if (!feat?.workflow_step) return;

  const { cwd, worktreePath } = resolveAgentCwd(featureId, projectId);

  switch (feat.workflow_step as WorkflowStep) {
    case "prd": {
      // PRD needs a description — read from feature prd or title
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
