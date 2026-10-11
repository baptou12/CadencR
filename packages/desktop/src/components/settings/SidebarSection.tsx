import {
  ChoiceControl,
  PresetControl,
  ResetDisplayOptionsButton,
  RowElementGrid,
  useSidebarDisplayForm,
} from "@/components/SidebarDisplayOptions";
import {
  CHOICE_ROWS,
  PRESET_DESCRIPTION,
  ROW_ELEMENTS_DESCRIPTION,
  SWITCH_ROWS,
} from "@/components/sidebar-display-rows";
import { SettingsCard } from "./SettingsCard";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import { SettingsSwitchRow } from "./SettingsSwitchRow";

/**
 * The sidebar's display options as settings rows. The sidebar's header popover
 * edits the same values in a compact layout.
 */
export function SidebarSection(): React.JSX.Element {
  const form = useSidebarDisplayForm();

  return (
    <SettingsSection
      id="sidebar-display"
      title="Sidebar"
      subtitle="Presets · Density · Rows · Blocks · Attention"
      description="Also available from the sliders button in the sidebar's Projects header. Changes apply immediately and follow you to remote devices."
    >
      <SettingsCard>
        <fieldset disabled={form.disabled} className="min-w-0">
          <SettingsRow
            label="Preset"
            description={PRESET_DESCRIPTION}
            control={<PresetControl form={form} />}
          />
          {CHOICE_ROWS.map((row) => (
            <SettingsRow
              key={row.id}
              divided
              label={row.label}
              description={row.description}
              control={<ChoiceControl form={form} row={row} />}
            />
          ))}
          <SettingsRow
            divided
            align="start"
            label="Show in rows"
            description={ROW_ELEMENTS_DESCRIPTION}
            control={<RowElementGrid form={form} className="gap-x-6 gap-y-2" />}
          />
          {SWITCH_ROWS.map((row) => (
            <SettingsSwitchRow
              key={row.id}
              divided
              label={row.label}
              description={row.description}
              checked={form.config[row.id]}
              onCheckedChange={(checked) => form.setOption(row.id, checked)}
            />
          ))}
          <SettingsRow
            divided
            label="Reset display options"
            description="Restore every option above to its default."
            control={<ResetDisplayOptionsButton form={form} variant="outline" size="sm" />}
          />
        </fieldset>
      </SettingsCard>
    </SettingsSection>
  );
}
