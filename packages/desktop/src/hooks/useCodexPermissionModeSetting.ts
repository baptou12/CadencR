import { useCallback, useMemo } from "react";
import { useGetWorkspaceSetting } from "@/api/generated";
import { toast } from "sonner";
import { useSetWorkspaceSettingWithCache } from "@/hooks/useSetWorkspaceSettingWithCache";
import { CODEX_PERMISSION_MODE_SETTING_KEY } from "@/shared/permission-mode-settings";
import { parseCodexPermissionMode, type CodexPermissionMode } from "@/types/codex-permission-mode";

interface UseCodexPermissionModeSettingResult {
  globalCodexPermissionMode: CodexPermissionMode;
  isPending: boolean;
  handleCodexPermissionModeChange: (mode: CodexPermissionMode) => void;
}

export function useCodexPermissionModeSetting(): UseCodexPermissionModeSettingResult {
  const codexPermissionSetting = useGetWorkspaceSetting(CODEX_PERMISSION_MODE_SETTING_KEY);
  const { setValue: setCodexPermissionMode, isPending } = useSetWorkspaceSettingWithCache(
    CODEX_PERMISSION_MODE_SETTING_KEY,
  );
  const globalCodexPermissionMode = parseCodexPermissionMode(codexPermissionSetting.data?.value);
  const handleCodexPermissionModeChange = useCallback(
    (mode: CodexPermissionMode): void => {
      setCodexPermissionMode(mode)
        .then(() => {
          toast.success("Codex access default updated for new conversations");
        })
        .catch((error: unknown) => {
          console.warn("Codex permission mode setting save failed after user-facing toast", error);
        });
    },
    [setCodexPermissionMode],
  );
  return useMemo(
    () => ({
      globalCodexPermissionMode,
      isPending,
      handleCodexPermissionModeChange,
    }),
    [globalCodexPermissionMode, isPending, handleCodexPermissionModeChange],
  );
}
