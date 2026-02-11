/**
 * Review Agent — reviews diff of all changes, flags issues, presents findings.
 *
 * Flow:
 * 1. Gets the git diff for all changes in the worktree/branch
 * 2. Reviews the diff for issues (bugs, style, security, performance)
 * 3. Presents findings to the user
 * 4. Offers options: "Add fix phase" or "Fix immediately"
 * 5. Updates feature status to "review" when review starts, "done" if approved
 */

import { getDatabase } from "../db/database";
import { startSubprocess, type ManagedSubprocess } from "./subprocess-manager";
import { bridgeSubprocessToRenderer } from "./ipc-bridge";
import type { AgentType, StreamEvent, StreamContentBlockStart, StreamContentBlockDelta } from "./types";
import type { PlanRow, PhaseRow } from "../db/types";

const REVIEW_SYSTEM_PROMPT = `You are the Review agent for ProductDevR, a development planning tool. Your job is to review code changes made during feature implementation and identify issues.

## Process

1. **Get the diff**: Run \`git diff\` and \`git diff --cached\` to see all changes in the working directory.
2. **Review the changes**: Carefully examine each changed file for:
   - **Bugs**: Logic errors, off-by-one errors, null pointer issues, race conditions
   - **Security**: XSS, injection, auth issues, secrets exposure
   - **Performance**: N+1 queries, unnecessary re-renders, memory leaks
   - **Code quality**: Dead code, unclear naming, missing error handling, inconsistent style
   - **Missing tests**: Important logic without test coverage
3. **Present findings**: Output a structured review report.

## Review Report Format

Output your review as a well-structured markdown document:

# Code Review Report

## Summary
Brief 2-3 sentence summary. State whether the changes are **Approved**, **Approved with suggestions**, or **Changes requested**.

## Issues Found

### Critical Issues
Issues that must be fixed before merging.
- [File:Line] Description of issue

### Warnings
Issues that should be addressed but aren't blockers.
- [File:Line] Description of issue

### Suggestions
Minor improvements and style suggestions.
- [File:Line] Description of suggestion

## What Looks Good
Highlight well-written code and good patterns observed.

## Verdict
State one of:
- **APPROVED** — No issues found, ready to merge
- **APPROVED_WITH_SUGGESTIONS** — Minor suggestions but OK to merge
- **CHANGES_REQUESTED** — Issues must be fixed before merging

## Rules
- Be thorough but fair — don't nitpick excessively
- Focus on real issues, not style preferences
- Always explain WHY something is an issue
- If the code is good, say so
- Include file paths and line numbers for every issue
`;

export interface ReviewAgentOptions {
  featureId: number;
  projectId: number;
  /** Working directory (worktree path or project path) */
  cwd: string;
}

export interface ReviewAgentResult {
  subprocessId: string;
  agentType: AgentType;
  sessionDbId: number;
}

/**
 * Start the review agent for a feature.
 */
export function startReviewAgent(options: ReviewAgentOptions): ReviewAgentResult {
  const db = getDatabase();

  // Update feature status to review
  db.prepare("UPDATE features SET status = 'review' WHERE id = ?").run(options.featureId);

  // Create agent session record
  const sessionResult = db
    .prepare(
      "INSERT INTO agent_sessions (feature_id, agent_type, status, started_at) VALUES (?, ?, ?, datetime('now'))",
    )
    .run(options.featureId, "review", "running");
  const sessionDbId = Number(sessionResult.lastInsertRowid);

  const prompt = `Please review the code changes for this feature.

Start by running \`git diff\` and \`git diff --cached\` to see all changes. Then review each change carefully and produce a detailed review report.

After presenting your review, if your verdict is APPROVED or APPROVED_WITH_SUGGESTIONS, end with:
---REVIEW_APPROVED---

If your verdict is CHANGES_REQUESTED, end with:
---REVIEW_CHANGES_REQUESTED---
followed by a brief summary of the fixes needed (one per line).`;

  const managed = startSubprocess({
    cwd: options.cwd,
    agentType: "review",
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    prompt,
  });

  // Bridge to renderer
  bridgeSubprocessToRenderer(managed, "review", sessionDbId);

  // Set up completion handler
  setupReviewCompletionHandler(managed, options.featureId, sessionDbId);

  return {
    subprocessId: managed.id,
    agentType: "review",
    sessionDbId,
  };
}

/**
 * Add a fix phase to the existing plan for later execution.
 */
export function addFixPhase(featureId: number, fixDescription: string): { phaseId: number } {
  const db = getDatabase();

  // Get the plan
  const plan = db
    .prepare("SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1")
    .get(featureId) as Pick<PlanRow, "id"> | undefined;

  if (!plan) {
    throw new Error("No plan found for this feature");
  }

  // Get the highest step_number and order_index
  const lastPhase = db
    .prepare("SELECT step_number, order_index FROM phases WHERE plan_id = ? ORDER BY step_number DESC, order_index DESC LIMIT 1")
    .get(plan.id) as Pick<PhaseRow, "step_number" | "order_index"> | undefined;

  const stepNumber = (lastPhase?.step_number ?? 0) + 1;
  const orderIndex = 0;

  const result = db
    .prepare(
      "INSERT INTO phases (plan_id, step_number, title, status, complexity, commit_message, prompt, order_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      plan.id,
      stepNumber,
      "Review fixes",
      "pending",
      2,
      "fix: address review findings",
      fixDescription,
      orderIndex,
    );

  return { phaseId: Number(result.lastInsertRowid) };
}

/**
 * Listen for subprocess completion and update feature status.
 */
function setupReviewCompletionHandler(
  managed: ManagedSubprocess,
  featureId: number,
  sessionDbId: number,
): void {
  let fullOutput = "";

  // Collect stdout text
  if (managed.process.stdout) {
    managed.process.stdout.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as StreamEvent;
          const text = extractTextFromEvent(event);
          if (text) fullOutput += text;
        } catch {
          // Not JSON, skip
        }
      }
    });
  }

  managed.process.on("exit", (code) => {
    const db = getDatabase();

    // Update session status
    db.prepare(
      "UPDATE agent_sessions SET status = ?, ended_at = datetime('now') WHERE id = ?",
    ).run(code === 0 ? "completed" : "error", sessionDbId);

    if (code === 0 && fullOutput) {
      // Store the review report as an agent message
      db.prepare(
        "INSERT INTO agent_messages (session_id, role, content, message_type) VALUES (?, ?, ?, ?)",
      ).run(sessionDbId, "assistant", fullOutput, "review_report");

      // Check verdict and update feature status
      if (fullOutput.includes("---REVIEW_APPROVED---")) {
        db.prepare("UPDATE features SET status = 'done' WHERE id = ?").run(featureId);
      }
      // If changes requested, feature stays in "review" status
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
