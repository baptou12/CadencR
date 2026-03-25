import { useCallback } from "react";
import { useDebouncedSetting } from "./useDebouncedSetting";

export type FeatureTab = "agent" | "terminal" | "git";

const VALID_TABS = new Set<FeatureTab>(["agent", "terminal", "git"]);

export function useActiveTab(featureId: number) {
  const setting = useDebouncedSetting(`active_tab_${featureId}`);

  const activeTab: FeatureTab =
    setting.value && VALID_TABS.has(setting.value as FeatureTab)
      ? (setting.value as FeatureTab)
      : "agent";

  const setActiveTab = useCallback(
    (tab: FeatureTab) => {
      setting.setValue(tab);
    },
    [setting],
  );

  return { activeTab, setActiveTab };
}
