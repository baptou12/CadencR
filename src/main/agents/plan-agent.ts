/**
 * Plan Agent — explores codebase, asks clarifying questions, generates a phased plan.
 *
 * Flow:
 * 1. User enters feature description in textarea
 * 2. Agent explores the codebase to understand context
 * 3. Agent asks 1-12 clarifying questions via AskUserQuestion tool
 * 4. Agent generates a phased plan with tasks, files, and commit messages
 * 5. Plan is parsed and stored in the plans/phases tables
 * 6. Feature status is updated to "planned"
 */

import { getDatabase } from "../db/database";
import { startSubprocess, type ManagedSubprocess } from "./subprocess-manager";
import { bridgeSubprocessToRenderer, notifyDbUpdated } from "./ipc-bridge";
import type { AgentType, StreamEvent, StreamContentBlockStart, StreamContentBlockDelta } from "./types";

const PLAN_SYSTEM_PROMPT = `You are the Plan agent for ProductDevR, a development planning tool. Your job is to create a detailed, phased implementation plan for a feature.

## Process

1. **Explore the codebase** using the available tools to understand the project structure, existing patterns, and relevant code.
2. **Ask clarifying questions** (1-12 questions) to fully understand the requirements. Use the AskUserQuestion tool to ask questions with suggested answer options.
3. **Generate a phased plan** based on your understanding.

## Plan Output Format

After gathering information, output the plan in the following structured format. Use EXACTLY this format so it can be parsed:

---PLAN_START---
# Plan: <title>

## Summary
<1-3 sentence summary of what will be built>

## Context
<What you learned about the codebase: key files, patterns, technologies, and constraints relevant to this feature. This helps the executor understand the environment without re-exploring.>

## Clarifications
<Q&A from the user. List each question you asked and the answer received. If no questions were asked, write "None".>

## Completion Conditions
<A table of conditions that should be true when the entire plan is complete. Use this format:>

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| <what should be true> | <command to run> | <expected result> |

<If there are no specific validation commands, write "None specified" instead of the table.>

## Phases

### Phase <N>: <title>
- **Step**: <step_number>
- **Complexity**: <1-5>
- **Tasks**:
  - <task 1>
  - <task 2>
- **Files**: <comma-separated list of files>
- **Commit message**: <conventional commit message>

(repeat for each phase)
---PLAN_END---

## Rules
- Each phase should be a coherent unit of work that can be completed independently
- Group related changes into the same phase
- Order phases so dependencies come first
- Phases in the same step can run in parallel
- Keep phases small enough to be reviewable (prefer more smaller phases over fewer large ones)
- Use conventional commit messages (feat:, fix:, refactor:, etc.)
- Complexity is 1-5 where 1 is trivial and 5 is very complex
- Include ALL files that will be modified in each phase
`;

export interface PlanAgentOptions {
  featureId: number;
  projectId: number;
  description: string;
  /** Working directory (worktree path or project path) */
  cwd: string;
}

export interface PlanAgentResult {
  subprocessId: string;
  agentType: AgentType;
  sessionDbId: number;
}

/**
 * Start the plan agent for a feature.
 */
export function startPlanAgent(options: PlanAgentOptions): PlanAgentResult {
  const db = getDatabase();

  // Create agent session record
  const sessionResult = db
    .prepare(
      "INSERT INTO agent_sessions (feature_id, agent_type, status, started_at) VALUES (?, ?, ?, datetime('now'))",
    )
    .run(options.featureId, "plan", "running");
  const sessionDbId = Number(sessionResult.lastInsertRowid);

  // Create plan record (draft)
  const planResult = db
    .prepare(
      "INSERT INTO plans (feature_id, title, status) VALUES (?, ?, 'draft')",
    )
    .run(options.featureId, `Plan for feature #${options.featureId}`);
  const planId = Number(planResult.lastInsertRowid);

  // Store plan ID in agent session for later reference
  db.prepare(
    "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
  ).run(options.featureId, "current_plan_id", String(planId));

  const prompt = `Please create a detailed implementation plan for the following feature:

${options.description}

Start by exploring the codebase to understand the project structure and existing patterns. Then ask me clarifying questions. Finally, generate a phased plan.`;

  const managed = startSubprocess({
    cwd: options.cwd,
    agentType: "plan",
    systemPrompt: PLAN_SYSTEM_PROMPT,
    prompt,
  });

  // Bridge to renderer
  bridgeSubprocessToRenderer(managed, "plan", sessionDbId);

  // Set up completion handler to parse plan output
  setupPlanCompletionHandler(managed, options.featureId, sessionDbId, planId);

  return {
    subprocessId: managed.id,
    agentType: "plan",
    sessionDbId,
  };
}

/**
 * Listen for subprocess completion and parse the plan output.
 */
function setupPlanCompletionHandler(
  managed: ManagedSubprocess,
  featureId: number,
  sessionDbId: number,
  planId: number,
): void {
  let fullOutput = "";

  // Collect text from stream events via the event listener API
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
      // Try to parse the plan
      const parsed = parsePlanOutput(fullOutput);
      if (parsed) {
        try {
          db.transaction(() => {
            // Store raw markdown and parsed sections
            db.prepare(
              "UPDATE plans SET raw_markdown = ?, title = ?, summary = ?, context = ?, clarifications = ?, completion_conditions = ?, status = 'active' WHERE id = ?",
            ).run(
              fullOutput,
              parsed.title,
              parsed.summary,
              parsed.context,
              parsed.clarifications,
              parsed.completionConditions,
              planId,
            );

            // Insert phases
            const insertPhase = db.prepare(
              "INSERT INTO phases (plan_id, step_number, title, status, complexity, commit_message, prompt, order_index) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)",
            );

            for (let i = 0; i < parsed.phases.length; i++) {
              const phase = parsed.phases[i];
              insertPhase.run(
                planId,
                phase.step,
                phase.title,
                phase.complexity,
                phase.commitMessage,
                phase.prompt,
                i,
              );
            }

            // Update feature status to planned
            db.prepare("UPDATE features SET status = 'planned' WHERE id = ?").run(featureId);
          })();
          notifyDbUpdated("phase", featureId);
          notifyDbUpdated("feature", featureId);
        } catch (err) {
          console.error("[plan-agent] Failed to save plan:", err);
          // Still store raw output even if phase insertion fails
          db.prepare("UPDATE plans SET raw_markdown = ?, status = 'draft' WHERE id = ?").run(
            fullOutput,
            planId,
          );
        }
      } else {
        // Could not parse — store raw output anyway
        db.prepare("UPDATE plans SET raw_markdown = ?, status = 'draft' WHERE id = ?").run(
          fullOutput,
          planId,
        );
      }
    } else if (code !== 0) {
      db.prepare("UPDATE plans SET status = 'draft' WHERE id = ?").run(planId);
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

export interface ParsedPlan {
  title: string;
  summary: string | null;
  context: string | null;
  clarifications: string | null;
  completionConditions: string | null;
  phases: ParsedPhase[];
}

export interface ParsedPhase {
  number: number;
  title: string;
  step: number;
  complexity: number;
  commitMessage: string;
  /** Raw phase body text to pass directly to the execute agent */
  prompt: string;
}

/**
 * Parse plan output from the agent's structured format.
 */
export function parsePlanOutput(output: string): ParsedPlan | null {
  // Extract content between markers
  const startMarker = "---PLAN_START---";
  const endMarker = "---PLAN_END---";

  let planContent = output;
  const startIdx = output.indexOf(startMarker);
  const endIdx = output.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1) {
    planContent = output.substring(startIdx + startMarker.length, endIdx).trim();
  } else if (startIdx !== -1) {
    planContent = output.substring(startIdx + startMarker.length).trim();
  }

  // Extract title
  const titleMatch = planContent.match(/^#\s+Plan:\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "Untitled Plan";

  // Extract sections between ## headings
  const extractSection = (heading: string): string | null => {
    const regex = new RegExp(
      `^##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
      "m",
    );
    const m = planContent.match(regex);
    if (!m) return null;
    const text = m[1].trim();
    return text || null;
  };

  const summary = extractSection("Summary");
  const context = extractSection("Context");
  const clarifications = extractSection("Clarifications");
  const completionConditions = extractSection("Completion Conditions");

  // Extract phases
  const phaseRegex =
    /###\s+Phase\s+(\d+):\s*([^\n]+)([\s\S]*?)(?=\n###\s+Phase|\n---PLAN_END---|$)/g;
  const phases: ParsedPhase[] = [];

  let match;
  while ((match = phaseRegex.exec(planContent)) !== null) {
    const phaseNum = parseInt(match[1], 10);
    const phaseTitle = match[2].trim();
    const phaseBody = match[0];

    // Parse step
    const stepMatch = phaseBody.match(/\*\*Step\*\*:\s*(\d+)/);
    const step = stepMatch ? parseInt(stepMatch[1], 10) : phaseNum;

    // Parse complexity
    const complexityMatch = phaseBody.match(/\*\*Complexity\*\*:\s*(\d+)/);
    const complexity = complexityMatch ? parseInt(complexityMatch[1], 10) : 3;

    // Parse commit message
    const commitMatch = phaseBody.match(/\*\*Commit message\*\*:\s*(.+)/);
    const commitMessage = commitMatch
      ? commitMatch[1].trim().replace(/`/g, "")
      : `phase ${phaseNum}`;

    phases.push({
      number: phaseNum,
      title: phaseTitle,
      step,
      complexity,
      commitMessage,
      prompt: phaseBody.trim(),
    });
  }

  if (phases.length === 0) {
    return null;
  }

  return { title, summary, context, clarifications, completionConditions, phases };
}
