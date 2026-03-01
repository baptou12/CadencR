/**
 * PRD agent MCP server.
 */

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { queryOne, execute } from "../../db/query";
import { notifyDbUpdated } from "../session-persistence";
import { textResult, errorResult } from "./helpers";
import { createAgentDoneTool } from "./shared-tools";
import type { OnAgentDoneCallback } from "./shared-tools";

/** Callback type for show_prd approval — blocks until user responds */
export type PrdApprovalCallback = (prdMarkdown: string) => Promise<{ approved: boolean; feedback?: string }>;

export function createPrdMcpServer(featureId: number, sessionDbId: number, onShowPrd?: PrdApprovalCallback, onAgentDone?: OnAgentDoneCallback) {
  return createSdkMcpServer({
    name: "productdevr-prd",
    tools: [
      createAgentDoneTool(sessionDbId, featureId, onAgentDone),

      tool(
        "create_prd",
        "Create the PRD for this feature. Use this for the initial PRD creation. Sends the full PRD markdown content.",
        {
          prd: z.string().describe("The full PRD markdown content"),
        },
        async (args) => {
          execute("UPDATE features SET prd = ? WHERE id = ?", args.prd, featureId);
          notifyDbUpdated("feature", featureId);
          return textResult("PRD created successfully.");
        },
      ),

      tool(
        "edit_prd",
        "Edit the PRD by finding a string and replacing it. The old_string must match exactly (including whitespace and newlines). Use this for revisions instead of rewriting the entire PRD.",
        {
          old_string: z.string().describe("The exact string to find in the current PRD"),
          new_string: z.string().describe("The string to replace it with"),
        },
        async (args) => {
          const row = queryOne<{ prd: string | null }>(
            "SELECT prd FROM features WHERE id = ?",
            featureId,
          ).toUndefined();

          if (!row?.prd) {
            return errorResult("No PRD exists yet. Use create_prd first.");
          }
          if (!row.prd.includes(args.old_string)) {
            return errorResult("old_string not found in the current PRD. Make sure it matches exactly.");
          }
          const occurrences = row.prd.split(args.old_string).length - 1;
          if (occurrences > 1) {
            return errorResult(`old_string found ${occurrences} times in the PRD. Provide a larger/more unique string to match exactly once.`);
          }
          const updated = row.prd.replace(args.old_string, args.new_string);
          execute("UPDATE features SET prd = ? WHERE id = ?", updated, featureId);
          notifyDbUpdated("feature", featureId);
          return textResult("PRD updated successfully.");
        },
      ),

      tool(
        "show_prd",
        "Display the current PRD for user approval. This tool BLOCKS until the user approves or rejects. If approved, returns success. If rejected, returns the user's feedback so you can revise.",
        {},
        async () => {
          const row = queryOne<{ prd: string | null }>(
            "SELECT prd FROM features WHERE id = ?",
            featureId,
          ).toUndefined();
          const prdMarkdown = row?.prd ?? "(No PRD content found)";

          if (!onShowPrd) {
            return textResult(prdMarkdown);
          }
          try {
            const result = await onShowPrd(prdMarkdown);
            if (result.approved) {
              return textResult("✅ PRD approved by the user. You may now call mark_agent_done.");
            } else {
              return errorResult(`User requested changes: ${result.feedback || "No specific feedback provided."}`);
            }
          } catch (error) {
            return errorResult(`PRD approval failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
      ),
    ],
  });
}
