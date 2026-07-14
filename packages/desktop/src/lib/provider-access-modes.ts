import { PROVIDER_IDS } from "@/lib/providers";
import {
  CODEX_PERMISSION_MODE_SETTING_KEY,
  CURSOR_ACCESS_MODE_SETTING_KEY,
} from "@/shared/permission-mode-settings";
export interface ProviderAccessModeConfig {
  providerLabel: string;
  settingKey: string;
}

const CONFIGS: Readonly<Record<string, ProviderAccessModeConfig>> = {
  [PROVIDER_IDS.CODEX_CLI]: {
    providerLabel: "Codex",
    settingKey: CODEX_PERMISSION_MODE_SETTING_KEY,
  },
  [PROVIDER_IDS.CURSOR]: {
    providerLabel: "Cursor",
    settingKey: CURSOR_ACCESS_MODE_SETTING_KEY,
  },
};

export function providerAccessModeConfig(
  providerId: string | undefined,
): ProviderAccessModeConfig | null {
  return providerId ? (CONFIGS[providerId] ?? null) : null;
}
