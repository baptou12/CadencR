import type { CommandsListPayload } from "@/lib/ws-envelope";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function optionalArray(record: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
}

interface ParsedPermissionOption {
  decision: "allow_once" | "allow_future" | "deny";
  label: string;
  description: string;
  collectFeedback?: boolean;
}

export function parseCommandsListPayload(payload: unknown): CommandsListPayload | null {
  const record = asRecord(payload);
  if (!record) return null;
  const commands = optionalArray(record, "commands");
  if (!commands) return { commands: [] };
  const parsed = commands
    .map((entry): { name: string; description?: string } | null => {
      const item = asRecord(entry);
      if (!item) return null;
      const name = optionalString(item, "name");
      if (!name) return null;
      const description = optionalString(item, "description");
      return description ? { name, description } : { name };
    })
    .filter((entry): entry is { name: string; description?: string } => entry !== null);
  return {
    commands: parsed,
  };
}

export function parseRuntimeSessionIdPayload(
  payload: unknown,
): { runtime_session_id?: string } | null {
  const record = asRecord(payload);
  if (!record) return null;
  return { runtime_session_id: optionalString(record, "runtime_session_id") };
}

export function parseInitializedPayload(payload: unknown): {
  session_id?: string;
  provider?: string;
  model?: string;
  thinking_effort?: string;
  input_tokens?: number;
  output_tokens?: number;
  context_window?: number;
} | null {
  const record = asRecord(payload);
  if (!record) return null;
  return {
    session_id: optionalString(record, "session_id"),
    provider: optionalString(record, "provider"),
    model: optionalString(record, "model"),
    thinking_effort: optionalString(record, "thinking_effort"),
    input_tokens: optionalNumber(record, "input_tokens"),
    output_tokens: optionalNumber(record, "output_tokens"),
    context_window: optionalNumber(record, "context_window"),
  };
}

export function parseModelPayload(payload: unknown): {
  model?: string;
  context_window?: number;
} | null {
  const record = asRecord(payload);
  if (!record) return null;
  const contextWindow = optionalNumber(record, "context_window");
  return {
    model: optionalString(record, "model"),
    context_window: contextWindow && contextWindow > 0 ? contextWindow : undefined,
  };
}

export function parseProviderPayload(payload: unknown): { provider?: string } | null {
  const record = asRecord(payload);
  if (!record) return null;
  return { provider: optionalString(record, "provider") };
}

export function parseModePayload(payload: unknown): { mode?: string } | null {
  const record = asRecord(payload);
  if (!record) return null;
  return { mode: optionalString(record, "mode") };
}

export function parseEffortPayload(payload: unknown): { thinking_effort?: string } | null {
  const record = asRecord(payload);
  if (!record) return null;
  return { thinking_effort: optionalString(record, "thinking_effort") };
}

export function parseFeatureUpdatedPayload(
  payload: unknown,
): { feature_id?: number; changed: string[] } | null {
  const record = asRecord(payload);
  if (!record) return null;
  const changed = (optionalArray(record, "changed") ?? []).filter(
    (entry): entry is string => typeof entry === "string",
  );
  return {
    feature_id: optionalNumber(record, "feature_id"),
    changed,
  };
}

export function parseMessageBlocksPayload(payload: unknown): { blocks: unknown[] } | null {
  const record = asRecord(payload);
  if (!record) return null;
  return { blocks: optionalArray(record, "blocks") ?? [] };
}

export function parsePermissionPayload(payload: unknown): {
  request_id?: string;
  tool_name?: string;
  tool_input: Record<string, unknown>;
  description?: string;
  pattern?: string;
  preview?: string;
  options: ParsedPermissionOption[];
} | null {
  const record = asRecord(payload);
  if (!record) return null;
  const toolInputRecord = asRecord(record.tool_input) ?? {};
  const options = (optionalArray(record, "options") ?? [])
    .map((entry): ParsedPermissionOption | null => {
      const item = asRecord(entry);
      if (!item) return null;
      const decision = optionalString(item, "decision");
      const label = optionalString(item, "label");
      const description = optionalString(item, "description");
      const collectFeedback = item.collect_feedback;
      if (!decision || !label || !description) return null;
      if (decision !== "allow_once" && decision !== "allow_future" && decision !== "deny") {
        return null;
      }
      return {
        decision,
        label,
        description,
        collectFeedback: typeof collectFeedback === "boolean" ? collectFeedback : undefined,
      };
    })
    .filter((entry): entry is ParsedPermissionOption => entry !== null);
  return {
    request_id: optionalString(record, "request_id"),
    tool_name: optionalString(record, "tool_name"),
    tool_input: toolInputRecord,
    description: optionalString(record, "description"),
    pattern: optionalString(record, "pattern"),
    preview: optionalString(record, "preview"),
    options,
  };
}

export function parseErrorPayload(payload: unknown): { message?: string } | null {
  const record = asRecord(payload);
  if (!record) return null;
  return { message: optionalString(record, "message") ?? optionalString(record, "error") };
}

export function parseEndedPayload(payload: unknown): { reason?: string } | null {
  const record = asRecord(payload);
  if (!record) return null;
  return { reason: optionalString(record, "reason") };
}

export function parseUsagePayload(payload: unknown): {
  input_tokens: number;
  output_tokens: number;
  context_window?: number;
} | null {
  const record = asRecord(payload);
  if (!record) return null;
  const contextWindow = optionalNumber(record, "context_window");
  return {
    input_tokens: optionalNumber(record, "input_tokens") ?? 0,
    output_tokens: optionalNumber(record, "output_tokens") ?? 0,
    context_window: contextWindow && contextWindow > 0 ? contextWindow : undefined,
  };
}

export function parseFeatureRenamePayload(
  payload: unknown,
): { feature_id?: number; title?: string } | null {
  const record = asRecord(payload);
  if (!record) return null;
  return {
    feature_id: optionalNumber(record, "feature_id"),
    title: optionalString(record, "title"),
  };
}

export function parseFeatureAutoNamingPayload(
  payload: unknown,
): { feature_id?: number; in_progress: boolean } | null {
  const record = asRecord(payload);
  if (!record) return null;
  return {
    feature_id: optionalNumber(record, "feature_id"),
    in_progress: record.in_progress === true,
  };
}

export function parseClearedPayload(payload: unknown): { previous_session_id?: string } | null {
  const record = asRecord(payload);
  if (!record) return null;
  return { previous_session_id: optionalString(record, "previous_session_id") };
}
