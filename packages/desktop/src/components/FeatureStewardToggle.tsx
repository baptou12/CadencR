import { ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getGetFeatureSettingsQueryKey,
  useGetFeatureSettings,
  useSetFeatureSetting,
} from "@/api/generated";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsSwitchRow } from "@/components/settings/SettingsSwitchRow";
import { apiErrorMessage } from "@/lib/api-errors";

const STEWARD_SETTING = "steward_workspace_writes";

/**
 * The per-feature Steward grant. While it is on, this feature's sessions may
 * call the workspace-wide MCP write tools (`workspace_update_feature`,
 * `workspace_stop_session`) against any project; while it is off, those calls
 * are refused with `STEWARD_REQUIRED`.
 *
 * The switch reflects what is stored, never what was requested: it advances
 * only once the backend confirms the write, and stays disabled while the save
 * is in flight, so a failed save can't leave the UI claiming authority nobody
 * granted.
 */
export function FeatureStewardToggle({ featureId }: { featureId: number }): React.JSX.Element {
  const queryClient = useQueryClient();
  const { data: settings } = useGetFeatureSettings(featureId);
  const enabled = settings?.find((setting) => setting.key === STEWARD_SETTING)?.value === "true";

  const setFeatureSetting = useSetFeatureSetting({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetFeatureSettingsQueryKey(featureId) });
      },
      onError: (error: unknown) => {
        toast.error(
          `Could not save workspace write setting: ${apiErrorMessage(error, "Unknown error")}`,
        );
      },
    },
  });

  return (
    <SettingsCard>
      <SettingsSwitchRow
        icon={<ShieldCheck className="size-4" />}
        iconTint="purple"
        label="Workspace writes (Steward)"
        description="Let this feature's agents organize and stop sessions across all projects."
        checked={enabled}
        disabled={setFeatureSetting.isPending}
        onCheckedChange={(checked) => {
          setFeatureSetting.mutate({
            id: featureId,
            data: { key: STEWARD_SETTING, value: String(checked) },
          });
        }}
      />
    </SettingsCard>
  );
}
