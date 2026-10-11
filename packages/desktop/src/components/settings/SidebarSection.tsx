import {
  ChoiceControl,
  PresetControl,
  ResetDisplayOptionsButton,
  RowElementGrid,
  useSidebarDisplayForm,
} from "@/components/SidebarDisplayOptions";
import { CHOICE_ROWS } from "@/components/sidebar-display-rows";
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
      subtitle="Presets · Density · Rows · Attention"
      description="Also available from the sliders button in the sidebar's Projects header. Changes apply immediately and follow you to remote devices."
    >
      <SettingsCard>
        <fieldset disabled={form.disabled} className="min-w-0">
          <SettingsRow
            label="Preset"
            description="Classic is the default. Picking a preset resets every display option it doesn't set; changing any of them makes it yours."
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
            description="The worktree marker on the title line, and the details on the line under it."
            control={<RowElementGrid form={form} className="gap-x-6 gap-y-2" />}
          />
          <SettingsSwitchRow
            divided
            label="For me block"
            description="Conversations waiting on you, failed or unread, across every project, oldest first. Hidden when empty."
            checked={form.config.forMe}
            onCheckedChange={(checked) => form.setOption("forMe", checked)}
          />
          <SettingsSwitchRow
            divided
            label="Type to filter"
            description="Typing while a sidebar row has focus filters conversations. Escape clears the filter."
            checked={form.config.typeToFilter}
            onCheckedChange={(checked) => form.setOption("typeToFilter", checked)}
          />
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
