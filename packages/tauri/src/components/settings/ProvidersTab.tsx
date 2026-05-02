import { useState, type ReactNode } from "react";
import { PROVIDER_IDS, type ProviderId } from "@/lib/providers";
import { BinaryDiscoverySection } from "./BinaryDiscoverySection";
import { CustomModelsSection } from "./CustomModelsSection";
import { DangerousModeToggle } from "./DangerousModeToggle";
import { ProfilesSection } from "./ProfilesSection";
import { ProviderPicker, type ProviderPickerOption } from "./ProviderPicker";
import {
  CLAUDE_BYPASS_PERMISSIONS_SETTING_KEY,
  CODEX_FULL_ACCESS_SETTING_KEY,
} from "@/shared/permission-mode-settings";

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
          description={
            <>
              Every <strong>claude</strong> install Cadence found on disk. The selected one is what
              gets spawned. To override, set a path during onboarding.
            </>
          }
        />
        <DangerousModeToggle
          settingKey={CLAUDE_BYPASS_PERMISSIONS_SETTING_KEY}
          title="Allow BypassPermissions"
          description={
            <>
              Adds <strong>Bypass</strong> to the permission-mode cycle in the agent prompt for
              Claude Code sessions. When active, Claude executes every tool call without prompting
              and skips all safety checks.
            </>
          }
          warningTitle="Enable BypassPermissions for Claude Code?"
          warningBody={
            <>
              <p>
                BypassPermissions disables every safety check. Claude can edit, delete, and run any
                command without confirmation, including destructive ones.
              </p>
              <p>
                Only enable this in isolated environments (containers, VMs, dev containers) where
                Claude Code cannot damage your host system. You can always toggle it off later.
              </p>
            </>
          }
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
        description={
          <>
            Every <strong>opencode</strong> install Cadence found on disk. Override via onboarding
            or the legacy <strong>CADENCE_OPENCODE_BIN</strong> env var.
          </>
        }
      />
    ),
  },
  {
    id: PROVIDER_IDS.CODEX_CLI,
    render: () => (
      <>
        <BinaryDiscoverySection
          discoveryKey="codex"
          description={
            <>
              Every <strong>codex</strong> install Cadence found on disk. The selected one is used
              to start <strong>codex app-server</strong>; override via onboarding or the{" "}
              <strong>codex_cli_path</strong> workspace setting.
            </>
          }
        />
        <DangerousModeToggle
          settingKey={CODEX_FULL_ACCESS_SETTING_KEY}
          title="Allow Full Access"
          description={
            <>
              Adds <strong>Full Access</strong> to the permission-mode cycle in the agent prompt for
              Codex sessions. Maps to Codex's <strong>danger-full-access</strong> sandbox plus{" "}
              <strong>--ask-for-approval never</strong>: Codex runs every command, can write
              anywhere, and can make network requests without prompting.
            </>
          }
          warningTitle="Enable Full Access for Codex?"
          warningBody={
            <>
              <p>
                Full Access removes the workspace-write sandbox and disables every approval prompt.
                Codex can modify files outside the project, reach the network freely, and execute
                arbitrary commands.
              </p>
              <p>
                Only enable this in isolated environments (containers, VMs, throwaway branches). You
                can always toggle it off later.
              </p>
            </>
          }
        />
      </>
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
