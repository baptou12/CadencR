import { useState, type ReactNode } from "react";
import { PROVIDER_IDS, type ProviderId } from "@/lib/providers";
import { BinaryDiscoverySection } from "./BinaryDiscoverySection";
import { CustomModelsSection } from "./CustomModelsSection";
import { ProfilesSection } from "./ProfilesSection";
import { ProviderPicker, type ProviderPickerOption } from "./ProviderPicker";

interface ProviderConfig {
  id: ProviderId;
  /** Renders the provider-specific subsections (binary discovery, profiles, etc.). */
  render: () => ReactNode;
}

/**
 * Per-provider configuration. Adding a new provider is one entry: id and the
 * subsection JSX. The picker, rendering, and accessibility wiring are all
 * driven from this list.
 */
const PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    id: PROVIDER_IDS.CLAUDE_CODE,
    render: () => (
      <>
        <BinaryDiscoverySection
          discoveryKey="claude"
          description="Every `claude` install Cadence found on disk. The selected one is what gets spawned. To override, set a path during onboarding."
        />
        <ProfilesSection />
        <CustomModelsSection />
      </>
    ),
  },
  {
    id: PROVIDER_IDS.OPENCODE,
    render: () => (
      <BinaryDiscoverySection
        discoveryKey="opencode"
        description="Every `opencode` install Cadence found on disk. Override via onboarding or the legacy `CADENCE_OPENCODE_BIN` env var."
      />
    ),
  },
];

const PICKER_OPTIONS: ProviderPickerOption[] = PROVIDER_CONFIGS.map((config) => ({
  id: config.id,
}));

export function ProvidersTab() {
  const [activeId, setActiveId] = useState<ProviderId>(PROVIDER_CONFIGS[0].id);
  const active = PROVIDER_CONFIGS.find((config) => config.id === activeId) ?? PROVIDER_CONFIGS[0];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4">
        <ProviderPicker options={PICKER_OPTIONS} activeId={activeId} onChange={setActiveId} />
      </div>
      <div
        id={`provider-panel-${active.id}`}
        role="tabpanel"
        className="flex-1 overflow-y-auto px-6 pb-6 space-y-8"
      >
        {active.render()}
      </div>
    </div>
  );
}
