import * as os from "os";
import { discoverClaudeCli } from "./cli-discovery";
import { CLAUDE_MODELS, type ClaudeModel } from "../../shared/models";

let cachedModels: ClaudeModel[] | null = null;
let fetchPromise: Promise<ClaudeModel[]> | null = null;

export function fetchAvailableModels(): Promise<ClaudeModel[]> {
  if (cachedModels) return Promise.resolve(cachedModels);
  if (fetchPromise) return fetchPromise;
  fetchPromise = doFetch();
  return fetchPromise;
}

async function doFetch(): Promise<ClaudeModel[]> {
  try {
    const cliInfo = await discoverClaudeCli();
    if (!cliInfo) return CLAUDE_MODELS;

    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const abortController = new AbortController();

    const q = query({
      prompt: "x",
      options: {
        cwd: os.homedir(),
        pathToClaudeCodeExecutable: cliInfo.path,
        abortController,
        settingSources: ["user"],
      },
    });

    let models: ClaudeModel[] | null = null;
    try {
      for await (const msg of q) {
        if (msg.type === "system" && msg.subtype === "init") {
          const infos = await q.supportedModels();
          models = infos.map((m) => ({ id: m.value, label: m.displayName }));
          abortController.abort();
          break;
        }
      }
    } catch {
      // AbortError is expected when we abort
    }

    if (models && models.length > 0) {
      cachedModels = models;
      return models;
    }
  } catch {
    // fallthrough to static fallback
  }
  return CLAUDE_MODELS;
}
