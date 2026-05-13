import type { AgentBlockData } from "@/components/AgentBlock";
import { parseToolArgsObject } from "@/lib/tool-args";
import { isFileChangeTool } from "@/lib/tool-adapter";

const BASH_OUTPUT_DELTA_KEY = "__cadencr_output_delta";

export function latestValidJsonSnapshot(content: string): string | undefined {
  try {
    JSON.parse(content);
    return content;
  } catch {
    // Fall through to recover the last full JSON object from concatenated snapshots.
  }

  for (let index = content.lastIndexOf("{"); index >= 0; ) {
    const candidate = content.slice(index);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Keep scanning backward.
    }
    const nextSearchStart = index - 1;
    index = nextSearchStart >= 0 ? content.lastIndexOf("{", nextSearchStart) : -1;
  }
  return undefined;
}

export function mergeToolContent(
  existing: AgentBlockData,
  incoming: string,
  action: string,
): string {
  if (shouldMergeObjectDeltas(existing.toolName) && action !== "replace") {
    const merged = mergeJsonObjects(existing.toolArgs || existing.content, incoming);
    if (merged) return merged;
  }
  return action === "replace" ? incoming : existing.content + incoming;
}

function mergeJsonObjects(baseJson: string, deltaJson: string): string | undefined {
  const base = parseToolArgsObject(baseJson);
  const delta = parseToolArgsObject(deltaJson);
  if (!base || !delta) return undefined;
  const outputDelta = delta[BASH_OUTPUT_DELTA_KEY];
  delete delta[BASH_OUTPUT_DELTA_KEY];
  if (typeof outputDelta === "string") {
    const priorOutput = typeof base.output === "string" ? base.output : "";
    return JSON.stringify({ ...base, ...delta, output: priorOutput + outputDelta });
  }
  return JSON.stringify({ ...base, ...delta });
}

function shouldMergeObjectDeltas(toolName: string | undefined): boolean {
  return toolName === "Bash" || isFileChangeTool(toolName);
}
