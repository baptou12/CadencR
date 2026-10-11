import {
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { LoaderCircle, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { UsageSegmentedControl } from "@/components/usage/UsageSegmentedControl";
import {
  CHOICE_ROWS,
  ROW_ELEMENTS,
  type ChoiceId,
  type ChoiceRow,
} from "@/components/sidebar-display-rows";
import {
  useSetSidebarOption,
  useSidebarConfigWrites,
  useSidebarSettings,
} from "@/hooks/useSidebarSettings";
import { matchSidebarPreset, SIDEBAR_PRESETS, type SidebarPresetId } from "@/lib/sidebar-presets";
import { cn } from "@/lib/utils";

/** State and actions shared by the popover form and the Settings section. */
export function useSidebarDisplayForm() {
  const { config, isFetched } = useSidebarSettings();
  const setOption = useSetSidebarOption();
  const { reset, applyPreset, isApplying } = useSidebarConfigWrites();
  return useMemo(
    () => ({
      config,
      setOption,
      reset,
      applyPreset,
      isApplying,
      disabled: !isFetched || isApplying,
    }),
    [config, setOption, reset, applyPreset, isApplying, isFetched],
  );
}

type SidebarDisplayForm = ReturnType<typeof useSidebarDisplayForm>;

export function ChoiceControl<K extends ChoiceId>({
  form,
  row,
}: {
  form: SidebarDisplayForm;
  row: ChoiceRow<K>;
}): ReactElement {
  return (
    <UsageSegmentedControl
      ariaLabel={row.label}
      value={form.config[row.id]}
      options={row.options}
      onChange={(value) => form.setOption(row.id, value)}
    />
  );
}

const PRESET_OPTIONS = SIDEBAR_PRESETS.map((preset) => ({
  value: preset.id,
  label: preset.label,
  title: preset.description,
}));

/** The built-in presets; none is selected once an option is customized. */
export function PresetControl({ form }: { form: SidebarDisplayForm }): ReactElement {
  const current = matchSidebarPreset(form.config);
  return (
    <UsageSegmentedControl<SidebarPresetId | "custom">
      ariaLabel="Preset"
      value={current ?? "custom"}
      options={PRESET_OPTIONS}
      onChange={(value) => {
        if (value !== "custom") form.applyPreset(value);
      }}
    />
  );
}

/** The per-row element checkboxes, two columns. */
export function RowElementGrid({
  form,
  className,
}: {
  form: SidebarDisplayForm;
  className?: string;
}): ReactElement {
  return (
    <div className={cn("grid grid-cols-2", className)}>
      {ROW_ELEMENTS.map((element) => (
        <RowElementToggle
          key={element.id}
          label={element.label}
          checked={form.config[element.id]}
          onChange={(checked) => form.setOption(element.id, checked)}
        />
      ))}
    </div>
  );
}

/** Reset, with a loader while the options load or the reset is in flight. */
export function ResetDisplayOptionsButton({
  form,
  ...buttonProps
}: { form: SidebarDisplayForm } & Pick<
  ComponentProps<typeof Button>,
  "variant" | "size" | "className" | "title"
>): ReactElement {
  return (
    <Button {...buttonProps} onClick={form.reset}>
      {form.disabled ? (
        <LoaderCircle
          className="animate-spin"
          aria-label={form.isApplying ? "Applying" : "Loading options"}
        />
      ) : (
        <RotateCcw />
      )}
      Reset
    </Button>
  );
}

/**
 * Every sidebar display option, applied live, in the popover's compact layout.
 * The Settings page lays the same options out as settings rows.
 */
export function SidebarDisplayOptionsForm({ className }: { className?: string }): ReactElement {
  const form = useSidebarDisplayForm();
  const filterId = useId();
  const forMeId = useId();

  return (
    <fieldset disabled={form.disabled} className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">Display options</span>
        <ResetDisplayOptionsButton
          form={form}
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          title="Restore every display option to its default"
        />
      </div>
      <OptionRow label="Preset">
        <PresetControl form={form} />
      </OptionRow>
      {CHOICE_ROWS.map((row) => (
        <OptionRow key={row.id} label={row.label}>
          <ChoiceControl form={form} row={row} />
        </OptionRow>
      ))}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-muted-foreground">Show in rows</span>
        <RowElementGrid form={form} className="gap-x-3 gap-y-1.5" />
      </div>
      <OptionRow label="For me block" htmlFor={forMeId}>
        <Switch
          id={forMeId}
          size="sm"
          checked={form.config.forMe}
          onCheckedChange={(checked) => form.setOption("forMe", checked)}
        />
      </OptionRow>
      <OptionRow label="Type to filter" htmlFor={filterId}>
        <Switch
          id={filterId}
          size="sm"
          checked={form.config.typeToFilter}
          onCheckedChange={(checked) => form.setOption("typeToFilter", checked)}
        />
      </OptionRow>
    </fieldset>
  );
}

/** Space between the sidebar's edge and the popover. */
const POPOVER_GAP_PX = 8;

/**
 * Header button that opens the display options beside the sidebar, never over
 * it: the rows stay visible, so each change previews live.
 */
export function SidebarDisplayOptionsPopover({ className }: { className?: string }): ReactElement {
  const [sideOffset, setSideOffset] = useState(POPOVER_GAP_PX);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Popover
      onOpenChange={(open) => {
        if (open && triggerRef.current) setSideOffset(offsetPastSidebar(triggerRef.current));
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon-xs"
          title="Display options"
          aria-label="Display options"
          className={cn("can-hover:data-[state=open]:opacity-100", className)}
        >
          <SlidersHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={sideOffset}
        className="max-h-(--radix-popover-content-available-height) w-[24rem] overflow-y-auto p-3"
      >
        <SidebarDisplayOptionsForm />
      </PopoverContent>
    </Popover>
  );
}

/** Distance from the trigger to just past the sidebar's right edge. */
function offsetPastSidebar(trigger: HTMLElement): number {
  const sidebar = trigger.closest("[data-app-sidebar]");
  if (!sidebar) return POPOVER_GAP_PX;
  const gap = sidebar.getBoundingClientRect().right - trigger.getBoundingClientRect().right;
  return Math.max(0, gap) + POPOVER_GAP_PX;
}

function OptionRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[11px] text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function RowElementToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): ReactElement {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(next) => onChange(next === true)} />
      <label htmlFor={id} className="text-xs">
        {label}
      </label>
    </div>
  );
}
