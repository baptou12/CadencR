/**
 * Retro agent MCP server.
 */

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { queryOne, queryAll } from "../../db/query";
import { textResult } from "./helpers";
import {
  readPlanTool,
  listPhasesTool,
  readPhaseTool,
  createAgentDoneTool,
} from "./shared-tools";
import type { OnAgentDoneCallback } from "./shared-tools";

export function createRetroMcpServer(featureId: number, sessionDbId: number, onAgentDone?: OnAgentDoneCallback) {
  return createSdkMcpServer({
    name: "productdevr-retro",
    tools: [
      readPlanTool,
      listPhasesTool,
      readPhaseTool,
      createAgentDoneTool(sessionDbId, featureId, onAgentDone),

      tool(
        "read_prd",
        "Read the PRD (Product Requirements Document) for this feature.",
        {},
        async () => {
          const row = queryOne<{ prd: string | null }>(
            "SELECT prd FROM features WHERE id = ?",
            featureId,
          ).toUndefined();
          return textResult(row?.prd ?? "No PRD available.");
        },
      ),

      tool(
        "list_conversations",
        "List all agent sessions for this feature with metadata and message counts. Use this to get an overview before reading individual conversations.",
        {},
        async () => {
          const result = queryAll<{
            id: number;
            agent_type: string;
            status: string;
            started_at: string | null;
            ended_at: string | null;
            message_count: number;
          }>(
            `SELECT s.id, s.agent_type, s.status, s.started_at, s.ended_at,
                COUNT(m.id) as message_count
              FROM agent_sessions s
              LEFT JOIN agent_messages m ON m.session_id = s.id
              WHERE s.feature_id = ?
              GROUP BY s.id
              ORDER BY s.id ASC`,
            featureId,
          );
          const sessions = result.getOr([]);

          if (sessions.length === 0) return textResult("No agent sessions found for this feature.");

          const lines = sessions.map(
            (s) =>
              `- Session ${s.id} [${s.agent_type}] status=${s.status} messages=${s.message_count} started=${s.started_at ?? "never"} ended=${s.ended_at ?? "running"}`,
          );
          return textResult(`${sessions.length} sessions:\n${lines.join("\n")}`);
        },
      ),

      tool(
        "read_conversation",
        "Read messages from an agent session with pagination. Returns messages formatted as [role] content with metadata.",
        {
          session_id: z.number().describe("The session ID to read messages from"),
          offset: z.number().optional().describe("Starting offset (default 0)"),
          limit: z.number().optional().describe("Max messages to return (default 50)"),
        },
        async (args) => {
          const resolvedOffset = args.offset ?? 0;
          const resolvedLimit = args.limit ?? 50;

          const total = queryOne<{ cnt: number }>(
            "SELECT COUNT(*) as cnt FROM agent_messages WHERE session_id = ?",
            args.session_id,
          ).map((r) => r.cnt).getOr(0);

          const msgResult = queryAll<{
            role: string;
            content: string;
            message_type: string;
            tool_name: string | null;
          }>(
            "SELECT role, content, message_type, tool_name FROM agent_messages WHERE session_id = ? ORDER BY id ASC LIMIT ? OFFSET ?",
            args.session_id,
            resolvedLimit,
            resolvedOffset,
          );
          const messages = msgResult.getOr([]);

          if (messages.length === 0 && resolvedOffset === 0) {
            return textResult(`No messages found for session ${args.session_id}.`);
          }

          const formatted = messages.map((m) => {
            const meta = m.tool_name ? ` (${m.message_type}, tool=${m.tool_name})` : m.message_type !== "text" ? ` (${m.message_type})` : "";
            return `[${m.role}]${meta} ${m.content}`;
          });

          const hasMore = resolvedOffset + messages.length < total;
          const summary = `Messages ${resolvedOffset + 1}-${resolvedOffset + messages.length} of ${total} total${hasMore ? " (more available)" : ""}:\n\n`;
          return textResult(summary + formatted.join("\n\n"));
        },
      ),
    ],
  });
}
