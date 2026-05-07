import { useMemo } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { PendingPermission } from "./ToolPermissionPrompt";

const PERMISSION_PROMPT_TYPING_IDLE_MS = 1000;

interface UseDeferredPermissionPromptArgs {
  pendingPermission?: PendingPermission | null;
  promptText: string;
}

interface DeferredPermissionPromptState {
  visiblePermission: PendingPermission | null;
  permissionDeferred: boolean;
}

export function useDeferredPermissionPrompt({
  pendingPermission,
  promptText,
}: UseDeferredPermissionPromptArgs): DeferredPermissionPromptState {
  const debouncedPromptText = useDebouncedValue(promptText, PERMISSION_PROMPT_TYPING_IDLE_MS);
  const permissionDeferred = !!pendingPermission && promptText !== debouncedPromptText;
  const visiblePermission = permissionDeferred ? null : (pendingPermission ?? null);

  return useMemo(
    () => ({ visiblePermission, permissionDeferred }),
    [visiblePermission, permissionDeferred],
  );
}
