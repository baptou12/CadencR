import { ModelSelector } from "@/components/ModelSelector";
import { SettingsCard } from "./SettingsCard";
import { SettingsSection } from "./SettingsSection";

export function RuntimeSettingsSection(): React.JSX.Element {
  return (
    <SettingsSection id="runtime" title="Runtime & Models" subtitle="Per-agent provider & model">
      <SettingsCard>
        <ModelSelector level="global" />
      </SettingsCard>
    </SettingsSection>
  );
}
