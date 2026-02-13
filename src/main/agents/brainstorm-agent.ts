/**
 * Brainstorm Agent — deep exploration + web research, extensive Q&A, comprehensive plan.
 *
 * Flow:
 * 1. User enters feature description
 * 2. Agent does deep codebase exploration and web research
 * 3. Agent asks 10-40 clarifying questions via AskUserQuestion tool
 * 4. Agent generates a comprehensive phased plan
 * 5. Plan is parsed and stored (reuses plan/phase storage from plan-agent)
 * 6. Feature status is updated to "planned"
 */

import { getDatabase } from "../db/database";
import { startSubprocess, type ManagedSubprocess } from "./subprocess-manager";
import { bridgeSubprocessToRenderer, notifyDbUpdated } from "./ipc-bridge";
import { parsePlanOutput } from "./plan-agent";
import type { AgentType, StreamEvent, StreamContentBlockStart, StreamContentBlockDelta } from "./types";

const BRAINSTORM_SYSTEM_PROMPT = `You are the Brainstorm agent for ProductDevR, a development planning tool. Your job is to perform deep, comprehensive research and produce a thorough implementation plan for a feature.

## Process

1. **Deep codebase exploration**: Thoroughly explore the codebase — read key files, understand architecture patterns, identify dependencies, trace data flows, and map out the full context relevant to this feature. Go deeper than a surface-level scan.

2. **Web research**: If relevant, research best practices, library documentation, common patterns, and potential pitfalls related to the feature's technology stack.

3. **Extensive questioning**: Ask 10-40 clarifying questions to fully understand every aspect of the feature. Use the AskUserQuestion tool. Cover:
   - Requirements and goals (what exactly should be built)
   - User experience details (interactions, edge cases, error states)
   - Technical approach (architecture decisions, data models, API design)
   - Integration points (how it connects to existing code)
   - Edge cases and error handling
   - Testing and quality expectations
   - Security and compliance concerns
   - Performance requirements
   - Operations and maintenance
   - Scope and priorities (what's in vs out)
   - Risks and unknowns

4. **Generate a comprehensive plan** based on all gathered information. The plan should be more detailed than a quick plan — include rationale, risk notes, and thorough task breakdowns.

## Plan Output Format

After gathering all information, output the plan in the following structured format. Use EXACTLY this format so it can be parsed:

---PLAN_START---
# Plan: <title>

## Summary
<detailed summary of what will be built, why, and the key technical decisions>

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
- Be thorough — this is a deep brainstorm, not a quick plan
- Ask MORE questions rather than fewer — aim for 10-40 questions to cover all angles
`;

export interface BrainstormAgentOptions {
  featureId: number;
  projectId: number;
  description: string;
  /** Working directory (worktree path or project path) */
  cwd: string;
}

export interface BrainstormAgentResult {
  subprocessId: string;
  agentType: AgentType;
  sessionDbId: number;
}

/**
 * Start the brainstorm agent for a feature.
 */
export function startBrainstormAgent(options: BrainstormAgentOptions): BrainstormAgentResult {
  const db = getDatabase();

  // Create agent session record
  const sessionResult = db
    .prepare(
      "INSERT INTO agent_sessions (feature_id, agent_type, status, started_at) VALUES (?, ?, ?, datetime('now'))",
    )
    .run(options.featureId, "brainstorm", "running");
  const sessionDbId = Number(sessionResult.lastInsertRowid);

  // Create plan record (draft)
  const planResult = db
    .prepare(
      "INSERT INTO plans (feature_id, title, status) VALUES (?, ?, 'draft')",
    )
    .run(options.featureId, `Brainstorm plan for feature #${options.featureId}`);
  const planId = Number(planResult.lastInsertRowid);

  // Store plan ID in feature settings
  db.prepare(
    "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
  ).run(options.featureId, "current_plan_id", String(planId));

  const prompt = `Please perform a deep brainstorm and create a comprehensive implementation plan for the following feature:

${options.description}

Start by thoroughly exploring the codebase to understand the full context. Research best practices if needed. Then ask me extensive clarifying questions (aim for 10-40 questions covering all aspects). Finally, generate a detailed phased plan.`;

  const managed = startSubprocess({
    cwd: options.cwd,
    agentType: "brainstorm",
    systemPrompt: BRAINSTORM_SYSTEM_PROMPT,
    prompt,
  });

  // Bridge to renderer
  bridgeSubprocessToRenderer(managed, "brainstorm", sessionDbId);

  // Set up completion handler to parse plan output
  setupBrainstormCompletionHandler(managed, options.featureId, sessionDbId, planId);

  return {
    subprocessId: managed.id,
    agentType: "brainstorm",
    sessionDbId,
  };
}

/**
 * Listen for subprocess completion and parse the plan output.
 * Reuses parsePlanOutput from plan-agent.
 */
function setupBrainstormCompletionHandler(
  managed: ManagedSubprocess,
  featureId: number,
  sessionDbId: number,
  planId: number,
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
      // Reuse plan parser from plan-agent
      const parsed = parsePlanOutput(fullOutput);
      if (parsed) {
        // Store raw markdown
        db.prepare("UPDATE plans SET raw_markdown = ?, title = ?, status = 'active' WHERE id = ?").run(
          fullOutput,
          parsed.title,
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
        notifyDbUpdated("phase", featureId);
        notifyDbUpdated("feature", featureId);
      } else {
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
