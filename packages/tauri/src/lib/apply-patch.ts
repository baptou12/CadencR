import { stringArg } from "@/lib/tool-args";

export interface ApplyPatchChange {
  kind: "add" | "update" | "delete";
  filePath: string;
  moveTo?: string;
  addedLines: string[];
  removedLines: string[];
}

export interface ApplyPatchPreview {
  filePath: string;
  oldContent: string;
  newContent: string;
}

const PATCH_TEXT_KEYS = ["patch_text", "patchText"] as const;
const ADD_PREFIX = "*** Add File: ";
const UPDATE_PREFIX = "*** Update File: ";
const DELETE_PREFIX = "*** Delete File: ";
const MOVE_PREFIX = "*** Move to: ";
const CREATED_FILE_PLACEHOLDER = "(file created)";
const DELETED_FILE_PLACEHOLDER = "(file deleted)";

export function extractApplyPatchText(args: Record<string, unknown>): string | undefined {
  return stringArg(args, ...PATCH_TEXT_KEYS);
}

export function isApplyPatchToolName(toolName: string | undefined): boolean {
  if (!toolName) return false;
  return toolName === "ApplyPatch" || toolName === "apply_patch";
}

export function parseApplyPatchChanges(patchText: string): ApplyPatchChange[] {
  const changes: ApplyPatchChange[] = [];
  let current: ApplyPatchChange | null = null;

  for (const line of patchText.split("\n")) {
    if (line === "*** End Patch") break;
    if (line.startsWith(ADD_PREFIX)) {
      current = { kind: "add", filePath: line.slice(ADD_PREFIX.length), addedLines: [], removedLines: [] };
      changes.push(current);
      continue;
    }
    if (line.startsWith(UPDATE_PREFIX)) {
      current = { kind: "update", filePath: line.slice(UPDATE_PREFIX.length), addedLines: [], removedLines: [] };
      changes.push(current);
      continue;
    }
    if (line.startsWith(DELETE_PREFIX)) {
      current = { kind: "delete", filePath: line.slice(DELETE_PREFIX.length), addedLines: [], removedLines: [] };
      changes.push(current);
      continue;
    }
    if (line.startsWith(MOVE_PREFIX)) {
      if (current) current.moveTo = line.slice(MOVE_PREFIX.length);
      continue;
    }
    if (!current || line === "*** End of File" || line.startsWith("@@")) continue;
    if (line.startsWith("+")) current.addedLines.push(line.slice(1));
    if (line.startsWith("-")) current.removedLines.push(line.slice(1));
  }

  return changes;
}

export function extractApplyPatchPrimaryPath(args: Record<string, unknown>): string | undefined {
  const patchText = extractApplyPatchText(args);
  if (!patchText) return undefined;
  const first = parseApplyPatchChanges(patchText)[0];
  if (!first) return undefined;
  return first.moveTo ?? first.filePath;
}

export function extractApplyPatchPreview(args: Record<string, unknown>): ApplyPatchPreview | null {
  const patchText = extractApplyPatchText(args);
  if (!patchText) return null;

  const changes = parseApplyPatchChanges(patchText);
  if (changes.length !== 1) return null;

  const [change] = changes;
  if (change.kind === "add") {
    const addedContent = change.addedLines.join("\n");
    return {
      filePath: change.moveTo ?? change.filePath,
      oldContent: "",
      newContent: addedContent || CREATED_FILE_PLACEHOLDER,
    };
  }

  if (change.kind === "delete") {
    const removedContent = change.removedLines.join("\n");
    return {
      filePath: change.filePath,
      oldContent: removedContent || DELETED_FILE_PLACEHOLDER,
      newContent: "",
    };
  }

  return {
    filePath: change.moveTo ?? change.filePath,
    oldContent: change.removedLines.join("\n"),
    newContent: change.addedLines.join("\n"),
  };
}
