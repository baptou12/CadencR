/**
 * Agent-specific configurations for the unified agent system.
 *
 * Each factory function returns a `UnifiedAgentConfig` containing the system
 * prompt, output patterns, and completion actions for a specific agent type.
 * The configs are NOT wired up yet -- they will be consumed in Phase 3 when
 * each agent's start function is rewritten to call `startUnifiedAgent()`.
 *
 * Important design decisions:
 * - Factory functions do NOT create DB records (plan records, session records).
 *   Pre-creation logic stays with the caller.
 * - Completion actions DO access planId, featureId, etc. via closures over the
 *   options parameter.
 * - System prompts are extracted verbatim from the individual agent files.
 */

import { Effect } from "effect";
import { loadPrompt } from "./prompts/load-prompt";
import { queryOne, execute } from "../db/query";
import { buildMcpServerFactory } from "./mcp-factory";
import type { OnAgentDoneCallback } from "./mcp-tools";
import type { ImageBlock, MessageContent, UnifiedAgentConfig, CompletionAction } from "./types";

// ---------------------------------------------------------------------------
// System prompts — extracted from individual agent files
// ---------------------------------------------------------------------------

const PLAN_SYSTEM_PROMPT = loadPrompt("plan.md");
const PRD_SYSTEM_PROMPT = loadPrompt("prd.md");
const RISK_SYSTEM_PROMPT = loadPrompt("risk.md");
const RETRO_SYSTEM_PROMPT = loadPrompt("retro.md");
function buildReviewSystemPrompt(autonomyLevel: 1 | 2 | 3): string {
  const basePrompt = loadPrompt("review.md");
  const completionSection =
    autonomyLevel === 1
      ? loadPrompt("review-completion-approval.md")
      : loadPrompt("review-completion-auto.md");

  return `${basePrompt}\n\n${completionSection}`;
}


function buildReviewFixerSystemPrompt(autonomyLevel: 1 | 2 | 3): string {
  const completionSection =
    autonomyLevel === 1
      ? loadPrompt("review-fixer-completion-approval.md")
      : loadPrompt("review-fixer-completion-auto.md");

  return `${loadPrompt("review-fixer.md")}

${completionSection}`;
}

export function buildQaSystemPrompt(autonomyLevel: 1 | 2 | 3): string {
  const basePrompt = loadPrompt("qa-base.md");
  const completionSection =
    autonomyLevel === 1
      ? loadPrompt("qa-completion-approval.md")
      : loadPrompt("qa-completion-auto.md");

  return `${basePrompt}

${completionSection}

## Rules
- Design test cases that are SPECIFIC to what was actually implemented — not generic tests
- Use the project's QA procedure to know HOW to test (simulators, MCPs, browser tools, etc.)
- Actually interact with the application — do not just read code and guess
- Be thorough — test happy paths, edge cases, and error scenarios
- Provide evidence for each test result (screenshots, console output, etc.)
- If proposing fix phases, make them precise and actionable`;
}

export function buildExecuteSystemPrompt(autonomyLevel: 1 | 2 | 3): string {
  const baseRole = loadPrompt("execute-base.md");
  const completionSection =
    autonomyLevel === 1
      ? loadPrompt("execute-completion-approval.md")
      : loadPrompt("execute-completion-auto.md");

  return `${baseRole}

## Important
- Stay focused on the current phase only
- If something is unclear, make a reasonable decision and proceed
- Quality over speed
- Always call mark_phase_done, even if everything went exactly to plan

${completionSection}

When your task is complete, call \`mark_agent_done\` and stop.`;
}

// ---------------------------------------------------------------------------
// Factory function option types
// ---------------------------------------------------------------------------

export interface PlanConfigOptions {
  featureId: number;
  projectId: number;
  cwd: string;
  description: MessageContent;
  /** Plan ID — must be created by the caller before calling this factory */
  planId: number;
  /** Worktree path for permission resolution */
  worktreePath?: string;
  /** When true, the description is a PRD — use PRD-specific preamble */
  hasPrd?: boolean;
  /** Callback for phase chaining when agent marks done */
  onAgentDone?: OnAgentDoneCallback;
}

export interface PrdConfigOptions {
  featureId: number;
  projectId: number;
  cwd: string;
  description: MessageContent;
  worktreePath?: string;
  onAgentDone?: OnAgentDoneCallback;
}

export interface RiskConfigOptions {
  featureId: number;
  projectId: number;
  cwd: string;
  /** Pre-built prompt that includes plan context (caller fetches plan) */
  prompt: string;
  /** Plan ID — when provided, gives the risk agent MCP tools for reading/creating phases */
  planId?: number;
  /** Worktree path for permission resolution */
  worktreePath?: string;
  onAgentDone?: OnAgentDoneCallback;
}

export interface ReviewConfigOptions {
  featureId: number;
  projectId: number;
  cwd: string;
  /** Plan ID for MCP tool access */
  planId: number;
  /** Worktree path for permission resolution */
  worktreePath?: string;
  /** PRD content if available */
  prd?: string;
  /** Plan summary */
  planSummary?: string;
  /** Codebase context from plan */
  planContext?: string;
  /** Clarifications from plan */
  planClarifications?: string;
  /** Previously completed phase titles */
  completedPhases?: { step_number: number; title: string }[];
  autonomyLevel?: 1 | 2 | 3;
  onAgentDone?: OnAgentDoneCallback;
}

export interface SessionConfigOptions {
  featureId?: number;
  projectId: number;
  cwd: string;
  prompt: MessageContent;
  resumeSessionId?: string;
  permissionMode?: "acceptEdits" | "plan";
  /** Worktree path for permission resolution */
  worktreePath?: string;
  /** When set, gives the session agent read-only MCP tools for the plan */
  planId?: number;
}

export interface ReviewFixerConfigOptions {
  featureId: number;
  projectId: number;
  cwd: string;
  prompt: MessageContent;
  worktreePath?: string;
  autonomyLevel?: 1 | 2 | 3;
}

export interface RetroConfigOptions {
  featureId: number;
  projectId: number;
  cwd: string;
  worktreePath?: string;
}

export interface QaConfigOptions {
  featureId: number;
  projectId: number;
  cwd: string;
  qaPrompt: string;
  completedPhasesSummary: string;
  planId: number;
  /** The ID of the QA phase being executed — agent uses this to call mark_phase_done */
  phaseId: number;
  /** Step number of the QA phase — fix phases will be inserted at step + 1 */
  qaPhaseStepNumber: number;
  worktreePath?: string;
  autonomyLevel?: 1 | 2 | 3;
  /** Full PRD markdown — included for the final QA phase to verify against functional requirements */
  prd?: string;
  onAgentDone?: OnAgentDoneCallback;
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a UnifiedAgentConfig for the plan agent.
 *
 * The caller must create the draft plan record in the DB before calling this,
 * and pass the `planId` in opts. The completion action uses the planId via
 * closure to store the parsed plan and phases.
 */
export function createPlanConfig(opts: PlanConfigOptions): UnifiedAgentConfig {
  const planInstructions = `The plan ID is ${opts.planId}. Use the MCP tools to build the plan as draft phases. Do NOT call finalize_plan until I explicitly approve — phases must stay in draft status until then.

Start by exploring the codebase to understand the project structure and existing patterns. Then ask me clarifying questions. Finally, build the phased plan using the tools, call show_plan, and ask for my approval.`;

  const preambleText = opts.hasPrd
    ? "Please create a detailed implementation plan based on the following Product Requirements Document (PRD):\n\n"
    : "Please create a detailed implementation plan for the following feature:\n\n";

  let prompt: MessageContent;
  if (typeof opts.description === "string") {
    prompt = `${preambleText}${opts.description}\n\n${planInstructions}`;
  } else {
    // description is a content array — prepend instruction text block and append tail
    const textPreamble: { type: "text"; text: string } = {
      type: "text",
      text: preambleText,
    };
    const textPostamble: { type: "text"; text: string } = {
      type: "text",
      text: `\n\n${planInstructions}`,
    };
    prompt = [textPreamble, ...(opts.description as Array<{ type: "text"; text: string } | ImageBlock>), textPostamble];
  }

  // Fallback completion action: if the agent exits without finalizing, ensure plan stays draft
  const completionActions: CompletionAction[] = [
    {
      event: "plan_fallback",
      handler: (output: string) => {
        const plan = Effect.runSync(queryOne<{ status: string }>("SELECT status FROM plans WHERE id = ?", opts.planId));

        if (plan && plan.status === "draft") {
          // Agent exited without finalizing — store raw output for reference
          if (output) {
            Effect.runSync(execute("UPDATE plans SET raw_markdown = ? WHERE id = ?", output, opts.planId));
          }
          console.warn(`[agent-configs] Plan agent exited without finalizing plan ${opts.planId}`);
        }
      },
    },
  ];

  return {
    agentType: "plan",
    systemPrompt: PLAN_SYSTEM_PROMPT,
    completionActions,
    featureId: opts.featureId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    prompt,
    worktreePath: opts.worktreePath,
    mcpServerFactory: buildMcpServerFactory("plan", opts.featureId, opts.planId, opts.onAgentDone),
  };
}

/**
 * Create a UnifiedAgentConfig for the PRD agent.
 *
 * The PRD agent creates a Product Requirements Document on the features table.
 * No plan row is created. Uses waitForPlanApproval for PRD approval flow.
 */
export function createPrdConfig(opts: PrdConfigOptions): UnifiedAgentConfig {
  const prdInstructions = `Use the MCP tools to build the PRD. Call create_prd to store the initial PRD content, then call show_prd to present it for approval. If rejected, use edit_prd for targeted changes (or create_prd for full rewrites), then call show_prd again. Once approved, call mark_agent_done.`;

  let prompt: MessageContent;
  if (typeof opts.description === "string") {
    prompt = `Please create a comprehensive PRD for the following feature:\n\n${opts.description}\n\n${prdInstructions}`;
  } else {
    const textPreamble: { type: "text"; text: string } = {
      type: "text",
      text: "Please create a comprehensive PRD for the following feature:\n\n",
    };
    const textPostamble: { type: "text"; text: string } = {
      type: "text",
      text: `\n\n${prdInstructions}`,
    };
    prompt = [textPreamble, ...(opts.description as Array<{ type: "text"; text: string } | ImageBlock>), textPostamble];
  }

  const completionActions: CompletionAction[] = [];

  return {
    agentType: "prd",
    systemPrompt: PRD_SYSTEM_PROMPT,
    completionActions,
    featureId: opts.featureId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    prompt,
    worktreePath: opts.worktreePath,
    mcpServerFactory: buildMcpServerFactory("prd", opts.featureId, undefined, opts.onAgentDone),
  };
}

/**
 * Create a UnifiedAgentConfig for the risk analysis agent.
 *
 * No structured output patterns. The completion action stores the full output
 * as a `risk_report` message in agent_messages.
 */
export function createRiskConfig(opts: RiskConfigOptions): UnifiedAgentConfig {
  const completionActions: CompletionAction[] = [
    {
      event: "store_risk_report",
      handler: (output: string, context) => {
        if (!output) return;
        Effect.runSync(execute(
          "INSERT INTO agent_messages (session_id, role, content, message_type) VALUES (?, ?, ?, ?)",
          context.sessionDbId, "assistant", output, "risk_report",
        ));
      },
    },
  ];

  return {
    agentType: "risk",
    systemPrompt: RISK_SYSTEM_PROMPT,
    completionActions,
    featureId: opts.featureId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    prompt: opts.prompt,
    worktreePath: opts.worktreePath,
    mcpServerFactory: buildMcpServerFactory("risk", opts.featureId, opts.planId, opts.onAgentDone),
  };
}

/**
 * Create a UnifiedAgentConfig for the review agent.
 *
 * The review agent uses MCP tools to create fix phases when changes are needed.
 * Completion action stores the review report as an agent_message.
 */
export function createReviewConfig(opts: ReviewConfigOptions): UnifiedAgentConfig {
  const sections: string[] = [];

  if (opts.prd) {
    sections.push(`## Product Requirements\n\n${opts.prd}`);
  }
  if (opts.planSummary) {
    sections.push(`## Plan Summary\n\n${opts.planSummary}`);
  }
  if (opts.planContext) {
    sections.push(`## Codebase Context\n\n${opts.planContext}`);
  }
  if (opts.planClarifications) {
    sections.push(`## Clarifications\n\n${opts.planClarifications}`);
  }
  if (opts.completedPhases && opts.completedPhases.length > 0) {
    const phaseList = opts.completedPhases
      .map((p) => `- Step ${p.step_number}: ${p.title}`)
      .join("\n");
    sections.push(
      `## Completed Phases\n\nThe following phases were implemented. Use the \`read_phase\` tool via \`list_phases\` if you need details about a specific phase.\n\n${phaseList}`,
    );
  }

  sections.push(
    `## Instructions\n\n**Plan ID: ${opts.planId}** — Use this ID when calling MCP tools like \`read_plan\`, \`list_phases\`, \`create_phase\`, \`finalize_phases\`, etc.\n\nReview the implementation against the specification above. Ask yourself: "If I had to build this from the spec, how should the code look?" Then compare with the actual changes.\n\nStart by running \`git diff\` and \`git diff --cached\` to see all changes. Review each change carefully and produce a detailed review report.\n\nYou have MCP tools available (prefixed with mcp__cadence-review__) to create fix phases if changes are needed. Follow the completion instructions in your system prompt to finalize your review.`,
  );

  const prompt = sections.join("\n\n---\n\n");

  const completionActions: CompletionAction[] = [
    {
      event: "store_review_report",
      handler: (output: string, context) => {
        if (!output) return;
        // Store the review report as an agent message
        Effect.runSync(execute(
          "INSERT INTO agent_messages (session_id, role, content, message_type) VALUES (?, ?, ?, ?)",
          context.sessionDbId, "assistant", output, "review_report",
        ));
      },
    },
  ];

  return {
    agentType: "review",
    systemPrompt: buildReviewSystemPrompt(opts.autonomyLevel ?? 1),
    completionActions,
    featureId: opts.featureId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    prompt,
    worktreePath: opts.worktreePath,
    mcpServerFactory: buildMcpServerFactory("review", opts.featureId, opts.planId, opts.onAgentDone),
  };
}

/**
 * Create a UnifiedAgentConfig for a free-form session agent.
 *
 * No output patterns or completion actions -- just a system prompt and the
 * user's message.
 */
export function createSessionConfig(opts: SessionConfigOptions): UnifiedAgentConfig {
  return {
    agentType: "session",
    featureId: opts.featureId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    prompt: opts.prompt,
    resumeSessionId: opts.resumeSessionId,
    permissionMode: opts.permissionMode,
    worktreePath: opts.worktreePath,
    mcpServerFactory: buildMcpServerFactory("session", opts.featureId ?? 0, opts.planId),
  };
}

/**
 * Create a UnifiedAgentConfig for the QA agent.
 *
 * The QA agent runs the project's test procedure and produces a structured
 * report. If tests fail, fix phases are parsed and inserted into the plan.
 */
export function createQaConfig(opts: QaConfigOptions): UnifiedAgentConfig {
  const prdSection = opts.prd
    ? `## Product Requirements Document (PRD)

The following PRD defines the functional and business requirements. Verify that the implementation satisfies ALL requirements listed here:

${opts.prd}

`
    : "";

  const prompt = `${prdSection}## What was implemented

${opts.completedPhasesSummary}

## QA Testing Procedure

The following procedure describes HOW to validate the implementation (tools, simulators, MCPs, commands, etc.):

${opts.qaPrompt}

The plan ID is ${opts.planId}. Your phase ID is ${opts.phaseId}. If you find failures that need fixes, use the MCP tools to create fix phases starting at step_number ${opts.qaPhaseStepNumber + 1}, then create a follow-up QA phase (type "qa") at the next step_number after all fix phases.

Based on what was implemented above, design specific test cases and execute them using the QA procedure. Verify that the features work correctly from a user's perspective.`;

  // Store QA report on completion
  const completionActions: CompletionAction[] = [
    {
      event: "store_qa_report",
      handler: (output: string, context) => {
        if (!output) return;
        Effect.runSync(execute(
          "INSERT INTO agent_messages (session_id, role, content, message_type) VALUES (?, ?, ?, ?)",
          context.sessionDbId, "assistant", output, "qa_report",
        ));
      },
    },
  ];

  return {
    agentType: "qa",
    systemPrompt: buildQaSystemPrompt(opts.autonomyLevel ?? 1),
    completionActions,
    featureId: opts.featureId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    prompt,
    worktreePath: opts.worktreePath,
    mcpServerFactory: buildMcpServerFactory("qa", opts.featureId, opts.planId, opts.onAgentDone),
  };
}

/**
 * Create a UnifiedAgentConfig for the retro agent.
 *
 * Read-only agent that reads all feature data and produces a retrospective
 * report stored as a `retro_report` message in agent_messages.
 */
export function createRetroConfig(opts: RetroConfigOptions): UnifiedAgentConfig {
  // Look up the plan ID so the agent knows which plan to read
  const planRow = Effect.runSync(queryOne<{ id: number }>("SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1", opts.featureId));

  const planHint = planRow
    ? `The plan ID for this feature is **${planRow.id}**. Use this when calling \`read_plan\` and \`list_phases\`.`
    : "No plan was found for this feature — skip plan/phase reading and focus on PRD and conversations.";

  const prompt = `Please produce a retrospective report for feature ID ${opts.featureId}.

${planHint}

Use the available MCP tools to read the PRD, plan, phases, and agent conversation history, then write the retrospective report in chat. When finished, call \`mark_agent_done\`.`;

  const completionActions: CompletionAction[] = [
    {
      event: "store_retro_report",
      handler: (output: string, context) => {
        if (!output) return;
        Effect.runSync(execute(
          "INSERT INTO agent_messages (session_id, role, content, message_type) VALUES (?, ?, ?, ?)",
          context.sessionDbId, "assistant", output, "retro_report",
        ));
      },
    },
  ];

  return {
    agentType: "retro",
    systemPrompt: RETRO_SYSTEM_PROMPT,
    completionActions,
    featureId: opts.featureId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    prompt,
    worktreePath: opts.worktreePath,
    mcpServerFactory: buildMcpServerFactory("retro", opts.featureId),
  };
}

/**
 * Create a UnifiedAgentConfig for the review-fixer agent.
 *
 * This agent receives diff comments, fixes code or answers questions,
 * and stays alive for follow-up. On completion, all 'sent' comments
 * for the feature are marked as 'resolved'.
 */
export function createReviewFixerConfig(opts: ReviewFixerConfigOptions): UnifiedAgentConfig {
  const completionActions: CompletionAction[] = [
    {
      event: "resolve_diff_comments",
      handler: (_output: string, context) => {
        if (!context.featureId) return;
        Effect.runSync(execute(
          "UPDATE diff_comments SET status = 'resolved' WHERE feature_id = ? AND status = 'sent'",
          context.featureId,
        ));
      },
    },
  ];

  return {
    agentType: "review-fixer",
    systemPrompt: buildReviewFixerSystemPrompt(opts.autonomyLevel ?? 1),
    completionActions,
    featureId: opts.featureId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    prompt: opts.prompt,
    permissionMode: "acceptEdits",
    worktreePath: opts.worktreePath,
  };
}
