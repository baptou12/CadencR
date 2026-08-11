import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { MONO_FONT_SETTING_KEY, resolveMonoStack } from "./constants";

interface UseMonoFontResult {
  /** The user's chosen family, or null when unset ("Default"). */
  family: string | null;
  /** The full CSS font-family value to apply. */
  resolved: string;
  setFamily: (value: string) => void;
  isLoading: boolean;
}

/**
 * Workspace setting persisting the user's monospace font family. A missing
 * value means "Default" and resolves to DEFAULT_MONO_STACK. Mirrors
 * `mono_font_family` in packages/service settings allowlist.
 */
export function useMonoFont(): UseMonoFontResult {
  const setting = useDebouncedSetting(MONO_FONT_SETTING_KEY, 250);
  return {
    family: setting.value || null,
    resolved: resolveMonoStack(setting.value),
    setFamily: setting.setValue,
    isLoading: setting.isLoading,
  };
}
