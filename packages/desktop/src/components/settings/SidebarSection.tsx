import {
  CHOICE_ROWS,
  ChoiceControl,
  ResetDisplayOptionsButton,
  RowElementGrid,
  useSidebarDisplayForm,
} from "@/components/SidebarDisplayOptions";
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
      subtitle="Density · Rows · Filter"
      description="Also available from the sliders button in the sidebar's Projects header. Changes apply immediately and follow you to remote devices."
    >
      <SettingsCard>
        <fieldset disabled={form.disabled} className="min-w-0">
          {CHOICE_ROWS.map((row, index) => (
            <SettingsRow
              key={row.id}
              divided={index > 0}
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
