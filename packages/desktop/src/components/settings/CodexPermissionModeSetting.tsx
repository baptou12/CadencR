import { useGetWorkspaceSetting } from "@/api/generated";
import { useSetWorkspaceSettingWithCache } from "@/hooks/useSetWorkspaceSettingWithCache";
import { CODEX_PERMISSION_MODE_SETTING_KEY } from "@/shared/permission-mode-settings";
import { parseCodexPermissionMode, type CodexPermissionMode } from "@/types/codex-permission-mode";
import { RadioCardGroup } from "@/components/settings/RadioCardGroup";
import { SettingsHeading } from "@/components/settings/SettingsHeading";

const CODEX_PERMISSION_MODE_OPTIONS = [
  {
    value: "default",
    label: "Default",
    description: "Workspace-write sandbox with approval requests routed to you.",
  },
  {
    value: "fullAccess",
    label: "Full Access",
    description: "Dangerous: no sandbox and no approval prompts.",
  },
  {
    value: "autoReview",
    label: "Auto Review",
    description: "Workspace-write sandbox with Codex auto-reviewing approval requests.",
  },
] satisfies ReadonlyArray<{
  value: CodexPermissionMode;
  label: string;
  description: string;
}>;

export function CodexPermissionModeSetting(): React.JSX.Element {
  const setting = useGetWorkspaceSetting(CODEX_PERMISSION_MODE_SETTING_KEY);
  const { setValue, isPending } = useSetWorkspaceSettingWithCache(
    CODEX_PERMISSION_MODE_SETTING_KEY,
  );
  const value = parseCodexPermissionMode(setting.data?.value);

  return (
    <div className="space-y-3">
      <SettingsHeading
        title="Codex access mode"
        description="Applies to new Codex conversations. Existing conversations keep the mode they started with."
      />
      <RadioCardGroup<CodexPermissionMode>
        value={value}
        onChange={(next) => {
          setValue(next).catch((error: unknown) => {
            console.warn(
              "Codex permission mode setting save failed after user-facing toast",
              error,
            );
          });
        }}
        options={CODEX_PERMISSION_MODE_OPTIONS}
        ariaLabel="Codex access mode"
        layout="grid"
        columns={3}
        disabled={setting.isLoading || isPending}
      />
    </div>
  );
}
