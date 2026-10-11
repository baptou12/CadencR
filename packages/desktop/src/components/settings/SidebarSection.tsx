import type { ReactElement } from "react";
import {
  ChoiceControl,
  PresetControl,
  ResetDisplayOptionsButton,
  RowElementGrid,
  useSidebarDisplayForm,
} from "@/components/SidebarDisplayOptions";
import {
  DISPLAY_GROUPS,
  PRESET_DESCRIPTION,
  resolveDisplayItem,
  ROW_ELEMENTS_DESCRIPTION,
  type DisplayItem,
} from "@/components/sidebar-display-rows";
import { useSidebarOptionHighlight } from "@/hooks/useSidebarOptionHighlight";
import { SettingsCard } from "./SettingsCard";
import { SettingsHeading } from "./SettingsHeading";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import { SettingsSubsection } from "./SettingsSubsection";
import { SettingsSwitchRow } from "./SettingsSwitchRow";
import { SidebarPreviewPanel } from "./SidebarPreviewPanel";

type SidebarDisplayForm = ReturnType<typeof useSidebarDisplayForm>;

/** In a narrow card (beside the preview, or a small window) controls go under their description. */
const STACKED = "@max-xl:flex-col @max-xl:items-start @max-xl:gap-2.5";

/**
 * The sidebar's display options as settings rows, grouped like the popover,
 * beside a live preview filled with sample conversations. The sidebar's header
 * popover edits the same values in a compact layout.
 */
export function SidebarSection(): ReactElement {
  const form = useSidebarDisplayForm();
  const highlight = useSidebarOptionHighlight();

  return (
    <SettingsSection
      id="sidebar-display"
      title="Sidebar"
      subtitle="Presets · Density · Rows · Blocks · Attention"
      description="Also available from the sliders button in the sidebar's Projects header. Changes apply immediately and follow you to remote devices. Point at an option to see what it changes in the preview."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start">
        <div className="lg:sticky lg:top-6 lg:order-last">
          <SidebarPreviewPanel />
        </div>
        <SettingsCard>
          <fieldset disabled={form.disabled} className="@container min-w-0" {...highlight}>
            {DISPLAY_GROUPS.map((group) => (
              <SettingsSubsection key={group.id} padded={false}>
                <div className="px-5 pt-4">
                  <SettingsHeading title={group.label} />
                </div>
                {group.items.map((item, index) => (
                  <SettingsItem key={item} form={form} item={item} divided={index > 0} />
                ))}
              </SettingsSubsection>
            ))}
            <SettingsSubsection padded={false}>
              <SettingsRow
                label="Reset display options"
                description="Restore every option above to its default."
                control={<ResetDisplayOptionsButton form={form} variant="outline" size="sm" />}
              />
            </SettingsSubsection>
          </fieldset>
        </SettingsCard>
      </div>
    </SettingsSection>
  );
}

function SettingsItem({
  form,
  item,
  divided,
}: {
  form: SidebarDisplayForm;
  item: DisplayItem;
  divided: boolean;
}): ReactElement {
  const resolved = resolveDisplayItem(item);
  if (resolved.kind === "preset") {
    return (
      <SettingsRow
        divided={divided}
        className={STACKED}
        label="Preset"
        description={PRESET_DESCRIPTION}
        control={<PresetControl form={form} />}
      />
    );
  }
  if (resolved.kind === "rowElements") {
    return (
      <SettingsRow
        divided={divided}
        align="start"
        className={STACKED}
        label="Show in rows"
        description={ROW_ELEMENTS_DESCRIPTION}
        control={<RowElementGrid form={form} className="gap-x-6 gap-y-2" />}
      />
    );
  }
  if (resolved.kind === "choice") {
    const { row } = resolved;
    return (
      <div data-sidebar-option={row.id}>
        <SettingsRow
          divided={divided}
          className={STACKED}
          label={row.label}
          description={row.description}
          control={<ChoiceControl form={form} row={row} />}
        />
      </div>
    );
  }
  const { row } = resolved;
  return (
    <div data-sidebar-option={row.id}>
      <SettingsSwitchRow
        divided={divided}
        label={row.label}
        description={row.description}
        checked={form.config[row.id]}
        onCheckedChange={(checked) => form.setOption(row.id, checked)}
      />
    </div>
  );
}
