import { Effect, Option } from "effect";
import { queryOne, execute } from "../db/query";
import { setupWorktreeForFeatureEffect } from "../effect/services/GitWorktree";
import { AppRuntime } from "../effect/runtime";
import { discoverClaudeCli } from "./cli-discovery";
import { notifyDbUpdated } from "./effect-helpers";

const AUTO_NAME_SYSTEM_PROMPT =
  "You are a feature naming assistant. Your ONLY job is to output a short name (3-7 words) for a coding session. ALWAYS output a name, even if the input is vague — just pick a reasonable generic name. Examples: 'hi' → 'General Coding Session', 'fix the login bug' → 'Fix Login Bug', 'I want to add dark mode' → 'Add Dark Mode Support'.";

const AUTO_NAME_MODEL = "claude-haiku-4-5-20251001";

/**
 * Auto-name a feature using a lightweight Haiku query.
 *
 * This is fire-and-forget — it spawns a single-turn SDK query, parses the name,
 * updates the feature title in the DB, and broadcasts a `db:updated` event so
 * the renderer can invalidate the features query.
 */
export function autoNameFeature(
  featureId: number,
  userInput: string,
  cwd: string,
  projectId?: number,
): void {
  runAutoName(featureId, userInput, cwd, projectId).catch((err) => {
    console.error("[auto-name] Failed:", err);
  });
}

async function runAutoName(
  featureId: number,
  userInput: string,
  cwd: string,
  projectId?: number,
): Promise<void> {
  const cliInfoOpt = await Effect.runPromise(discoverClaudeCli().pipe(Effect.option));
  if (Option.isNone(cliInfoOpt)) return;
  const cliInfo = cliInfoOpt.value;

  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const { query } = sdk as {
    query: (opts: {
      prompt: string;
      options?: Record<string, unknown>;
    }) => AsyncIterable<Record<string, unknown>>;
  };

  const prompt = `Now name this session. User's first message: "${userInput.replace(/"/g, '\\"')}". Reply with ONLY: __FEATURE_NAME_START__<name>__FEATURE_NAME_END__`;

  let accumulatedText = "";

  const result = query({
    prompt,
    options: {
      cwd,
      permissionMode: "acceptEdits" as const,
      pathToClaudeCodeExecutable: cliInfo.path,
      model: AUTO_NAME_MODEL,
      systemPrompt: AUTO_NAME_SYSTEM_PROMPT,
      allowedTools: [],
    },
  });

  for await (const msg of result) {
    const type = msg.type as string;
    if (type === "stream_event") {
      const event = msg.event as Record<string, unknown>;
      if (!event) continue;
      if (
        event.type === "content_block_start" &&
        (event.content_block as Record<string, unknown>)?.type === "text"
      ) {
        accumulatedText += (event.content_block as Record<string, unknown>).text as string;
      } else if (
        event.type === "content_block_delta" &&
        (event.delta as Record<string, unknown>)?.type === "text_delta"
      ) {
        accumulatedText += (event.delta as Record<string, unknown>).text as string;
      }
    } else if (type === "assistant") {
      const message = msg.message as Record<string, unknown> | undefined;
      const content = message?.content as Array<Record<string, unknown>> | undefined;
      if (content) {
        for (const block of content) {
          if (block.type === "text") {
            accumulatedText += block.text as string;
          }
        }
      }
    }
  }

  const match = accumulatedText.match(
    /__FEATURE_NAME_START__(.+?)__FEATURE_NAME_END__/,
  );
  const name = (match ? match[1] : accumulatedText)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!name) return;

  Effect.runSync(execute("UPDATE features SET title = ? WHERE id = ?", name, featureId));
  notifyDbUpdated("feature", featureId);

  // Chain worktree setup after naming (only for non-session features)
  if (projectId != null) {
    const feature = Effect.runSync(queryOne<{ type: string }>("SELECT type FROM features WHERE id = ?", featureId));
    if (feature?.type !== "ws-session") {
      AppRuntime.runPromise(setupWorktreeForFeatureEffect(projectId, featureId)).catch(
        (err) => {
          console.error("[auto-name] Worktree setup failed:", err);
        },
      );
    }
  }
}

/**
 * Run ONLY the auto-naming logic (blocking). Does NOT chain worktree setup.
 * Returns the generated name, or null if naming failed.
 */
export async function runAutoNameBlocking(
  featureId: number,
  userInput: string,
  cwd: string,
): Promise<string | null> {
  const cliInfoOpt = await Effect.runPromise(discoverClaudeCli().pipe(Effect.option));
  if (Option.isNone(cliInfoOpt)) return null;
  const cliInfo = cliInfoOpt.value;

  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const { query } = sdk as {
    query: (opts: {
      prompt: string;
      options?: Record<string, unknown>;
    }) => AsyncIterable<Record<string, unknown>>;
  };

  const prompt = `Now name this session. User's first message: "${userInput.replace(/"/g, '\\"')}". Reply with ONLY: __FEATURE_NAME_START__<name>__FEATURE_NAME_END__`;

  let accumulatedText = "";

  const result = query({
    prompt,
    options: {
      cwd,
      permissionMode: "acceptEdits" as const,
      pathToClaudeCodeExecutable: cliInfo.path,
      model: AUTO_NAME_MODEL,
      systemPrompt: AUTO_NAME_SYSTEM_PROMPT,
      allowedTools: [],
    },
  });

  for await (const msg of result) {
    const type = msg.type as string;
    if (type === "stream_event") {
      const event = msg.event as Record<string, unknown>;
      if (!event) continue;
      if (
        event.type === "content_block_start" &&
        (event.content_block as Record<string, unknown>)?.type === "text"
      ) {
        accumulatedText += (event.content_block as Record<string, unknown>).text as string;
      } else if (
        event.type === "content_block_delta" &&
        (event.delta as Record<string, unknown>)?.type === "text_delta"
      ) {
        accumulatedText += (event.delta as Record<string, unknown>).text as string;
      }
    } else if (type === "assistant") {
      const message = msg.message as Record<string, unknown> | undefined;
      const content = message?.content as Array<Record<string, unknown>> | undefined;
      if (content) {
        for (const block of content) {
          if (block.type === "text") {
            accumulatedText += block.text as string;
          }
        }
      }
    }
  }

  const match = accumulatedText.match(
    /__FEATURE_NAME_START__(.+?)__FEATURE_NAME_END__/,
  );
  const name = (match ? match[1] : accumulatedText)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!name) return null;

  Effect.runSync(execute("UPDATE features SET title = ? WHERE id = ?", name, featureId));
  notifyDbUpdated("feature", featureId);

  return name;
}
