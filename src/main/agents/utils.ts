/**
 * Shared utilities for agent code.
 *
 * Centralises helpers that were previously duplicated across
 * plan-agent, brainstorm-agent, risk-agent, review-agent, and execute-agent.
 */

import type {
  StreamEvent,
  StreamContentBlockStart,
  StreamContentBlockDelta,
} from "./types";

/**
 * Extract text content from a stream event.
 *
 * Returns the text string carried by `content_block_start` (text blocks) and
 * `content_block_delta` (text deltas), or `null` for all other event types.
 */
export function extractTextFromEvent(event: StreamEvent): string | null {
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

// ---------------------------------------------------------------------------
// Plan output parsing — used by plan-agent and brainstorm-agent
// ---------------------------------------------------------------------------

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
 *
 * Extracts the plan content between `---PLAN_START---` / `---PLAN_END---`
 * markers and parses title, summary, context, clarifications, completion
 * conditions, and phases.
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
      `(?:^|\\n)##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
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
