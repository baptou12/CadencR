import { useMemo } from "react";
import { useGetWorkspaceSetting } from "@/api/generated";
import { PROVIDER_IDS } from "@/lib/providers";
import {
  CLAUDE_BYPASS_PERMISSIONS_SETTING_KEY,
  CODEX_FULL_ACCESS_SETTING_KEY,
} from "@/shared/permission-mode-settings";
import type { PermissionMode } from "@/types/permission-mode";

const NO_OPT_IN_MODES: PermissionMode[] = [];
const BYPASS_PERMISSION_MODES: PermissionMode[] = ["bypassPermissions"];

function modesForProvider(
  providerId: string,
  claudeBypassEnabled: boolean,
  codexFullAccessEnabled: boolean,
): PermissionMode[] {
  if (providerId === PROVIDER_IDS.CLAUDE_CODE && claudeBypassEnabled) {
    return BYPASS_PERMISSION_MODES;
  }
  if (providerId === PROVIDER_IDS.CODEX_CLI && codexFullAccessEnabled) {
    return BYPASS_PERMISSION_MODES;
  }
  return NO_OPT_IN_MODES;
}

export function useEnabledOptInModes(activeProviderId: string): PermissionMode[] {
  const claudeBypassSetting = useGetWorkspaceSetting(CLAUDE_BYPASS_PERMISSIONS_SETTING_KEY);
  const codexFullAccessSetting = useGetWorkspaceSetting(CODEX_FULL_ACCESS_SETTING_KEY);
  const claudeBypassEnabled = claudeBypassSetting.data?.value === "true";
  const codexFullAccessEnabled = codexFullAccessSetting.data?.value === "true";

  return useMemo(
    () => modesForProvider(activeProviderId, claudeBypassEnabled, codexFullAccessEnabled),
    [activeProviderId, claudeBypassEnabled, codexFullAccessEnabled],
  );
}

export function useEnabledOptInModesByProvider(): (providerId: string) => PermissionMode[] {
  const claudeBypassSetting = useGetWorkspaceSetting(CLAUDE_BYPASS_PERMISSIONS_SETTING_KEY);
  const codexFullAccessSetting = useGetWorkspaceSetting(CODEX_FULL_ACCESS_SETTING_KEY);
  const claudeBypassEnabled = claudeBypassSetting.data?.value === "true";
  const codexFullAccessEnabled = codexFullAccessSetting.data?.value === "true";

  return useMemo(
    () =>
      (providerId: string): PermissionMode[] =>
        modesForProvider(providerId, claudeBypassEnabled, codexFullAccessEnabled),
    [claudeBypassEnabled, codexFullAccessEnabled],
  );
}
