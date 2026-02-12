/**
 * Risk Analysis Agent — reads plan, explores codebase, generates markdown risk report.
 *
 * Flow:
 * 1. Reads the existing plan for the feature
 * 2. Explores the codebase to understand impact
 * 3. Generates a markdown risk report covering: deployment risks, data impact,
 *    dependency risks, and a verification checklist
 * 4. Stores the risk report in agent_messages
 */

import { getDatabase } from "../db/database";
import { startSubprocess, type ManagedSubprocess } from "./subprocess-manager";
import { bridgeSubprocessToRenderer } from "./ipc-bridge";
import type { AgentType, StreamEvent, StreamContentBlockStart, StreamContentBlockDelta } from "./types";

const RISK_SYSTEM_PROMPT = `You are the Risk Analysis agent for ProductDevR, a development planning tool. Your job is to evaluate the risk profile of a planned feature before execution begins.

## Process

1. **Read the plan**: Carefully review the implementation plan provided to you.
2. **Explore the codebase**: Examine the files that will be modified, their dependencies, and the broader codebase context. Look for potential conflicts, fragile code, and integration points.
3. **Generate a risk report**: Produce a comprehensive markdown risk report.

## Risk Report Format

Output your risk report as a well-structured markdown document covering these sections:

# Risk Analysis Report

## Summary
A brief 2-3 sentence summary of the overall risk level (Low / Medium / High / Critical) and rationale.

## Deployment Risks
- What could go wrong during or after deployment?
- Are there breaking changes?
- Is a migration required?
- Could this cause downtime?

## Data Impact
- Does this change affect stored data, schemas, or data flows?
- Is there risk of data loss or corruption?
- Are there backup/rollback considerations?

## Dependency Risks
- Are new dependencies being added?
- Are existing dependencies being upgraded or changed?
- Are there version compatibility concerns?
- Could transitive dependencies cause issues?

## Code Quality Risks
- Are there complex areas prone to bugs?
- Are there race conditions or concurrency concerns?
- Are there security implications?
- Are there performance implications?

## Verification Checklist
A bulleted checklist of things to verify before, during, and after execution:
- [ ] Item 1
- [ ] Item 2
- ...

## Recommendations
Specific actionable recommendations to mitigate identified risks.

## Rules
- Be thorough but concise
- Focus on actionable insights, not theoretical concerns
- Rate each risk section as Low/Medium/High
- The verification checklist should be practical and specific to this feature
- If the plan is low-risk, say so clearly — don't inflate risks unnecessarily
`;

export interface RiskAgentOptions {
  featureId: number;
  projectId: number;
  /** Working directory (worktree path or project path) */
  cwd: string;
}

export interface RiskAgentResult {
  subprocessId: string;
  agentType: AgentType;
  sessionDbId: number;
}

/**
 * Start the risk analysis agent for a feature.
 */
export function startRiskAgent(options: RiskAgentOptions): RiskAgentResult {
  const db = getDatabase();

  // Fetch the plan for context
  const plan = db
    .prepare("SELECT id, raw_markdown, title FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1")
    .get(options.featureId) as { id: number; raw_markdown: string | null; title: string } | undefined;

  // Create agent session record
  const sessionResult = db
    .prepare(
      "INSERT INTO agent_sessions (feature_id, agent_type, status, started_at) VALUES (?, ?, ?, datetime('now'))",
    )
    .run(options.featureId, "risk", "running");
  const sessionDbId = Number(sessionResult.lastInsertRowid);

  const planContext = plan?.raw_markdown
    ? `\n\nHere is the implementation plan to evaluate:\n\n${plan.raw_markdown}`
    : "";

  const prompt = `Please perform a risk analysis for this feature.${planContext}

Start by exploring the codebase to understand the full context and impact of these changes. Then generate a comprehensive risk report in markdown format.`;

  const managed = startSubprocess({
    cwd: options.cwd,
    agentType: "risk",
    systemPrompt: RISK_SYSTEM_PROMPT,
    prompt,
  });

  // Bridge to renderer
  bridgeSubprocessToRenderer(managed, "risk", sessionDbId);

  // Set up completion handler to store risk report
  setupRiskCompletionHandler(managed, options.featureId, sessionDbId);

  return {
    subprocessId: managed.id,
    agentType: "risk",
    sessionDbId,
  };
}

/**
 * Listen for subprocess completion and store the risk report in agent_messages.
 */
function setupRiskCompletionHandler(
  managed: ManagedSubprocess,
  _featureId: number,
  sessionDbId: number,
): void {
  let fullOutput = "";

  // Collect output text via event listeners
  managed.eventListeners.push((event: StreamEvent) => {
    const text = extractTextFromEvent(event);
    if (text) fullOutput += text;
  });

  managed.completionListeners.push((code: number) => {
    const db = getDatabase();

    // Update session status
    db.prepare(
      "UPDATE agent_sessions SET status = ?, ended_at = datetime('now') WHERE id = ?",
    ).run(code === 0 ? "completed" : "error", sessionDbId);

    if (code === 0 && fullOutput) {
      // Store the risk report as an agent message
      db.prepare(
        "INSERT INTO agent_messages (session_id, role, content, message_type) VALUES (?, ?, ?, ?)",
      ).run(sessionDbId, "assistant", fullOutput, "risk_report");
    }
  });
}

/**
 * Extract text content from a stream event.
 */
function extractTextFromEvent(event: StreamEvent): string | null {
  if (event.type === "content_block_start") {
    const blockEvent = event as StreamContentBlockStart;
    if (blockEvent.content_block.type === "text") {
      return blockEvent.content_block.text;
    }
  }
  if (event.type === "content_block_delta") {
    const deltaEvent = event as StreamContentBlockDelta;
    if (deltaEvent.delta.type === "text_delta") {
      return deltaEvent.delta.text;
    }
  }
  return null;
}
