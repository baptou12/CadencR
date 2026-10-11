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
import {
  UsageSegmentedControl,
  type SegmentedOption,
} from "@/components/usage/UsageSegmentedControl";
import {
  useResetSidebarConfig,
  useSetSidebarOption,
  useSidebarSettings,
} from "@/hooks/useSidebarSettings";
import type { SidebarConfig, SidebarOptionId } from "@/lib/sidebar-config";
import { cn } from "@/lib/utils";

type ChoiceId = {
  [K in SidebarOptionId]: SidebarConfig[K] extends string ? K : never;
}[SidebarOptionId];
type ToggleId = {
  [K in SidebarOptionId]: SidebarConfig[K] extends boolean ? K : never;
}[SidebarOptionId];

interface ChoiceRow<K extends ChoiceId> {
  id: K;
  label: string;
  /** Shown on the Settings page, where there is room to explain. */
  description: string;
  options: readonly SegmentedOption<SidebarConfig[K]>[];
}

// Mapped per key, so each row's options must be that option's own values.
export const CHOICE_ROWS: readonly { [K in ChoiceId]: ChoiceRow<K> }[ChoiceId][] = [
  {
    id: "density",
    description: "Height of each row: 28, 36 or 44 px.",
    label: "Density",
    options: [
      { value: "compact", label: "Compact" },
      { value: "comfortable", label: "Comfortable" },
      { value: "spacious", label: "Spacious" },
    ],
  },
  {
    id: "fontSize",
    description: "Size of conversation titles, in pixels.",
    label: "Text size",
    options: [
      { value: "12", label: "12" },
      { value: "12.5", label: "12.5" },
      { value: "13", label: "13" },
      { value: "14", label: "14" },
    ],
  },
  {
    id: "titleLines",
    description: "How much of a long title shows.",
    label: "Title",
    options: [
      { value: "one", label: "1 line" },
      { value: "two", label: "2 lines" },
      { value: "hover", label: "Full on hover", title: "One line, the full title on hover" },
    ],
  },
  {
    id: "titleSource",
    description: "Lead with the conversation title, its worktree branch, or its worktree folder.",
    label: "Title from",
    options: [
      { value: "title", label: "Title" },
      { value: "branch", label: "Branch", title: "The worktree branch, else the title" },
      { value: "folder", label: "Folder", title: "The worktree folder, else the title" },
    ],
  },
  {
    id: "status",
    description: "How working, unread and idle conversations show. Pending requests always show.",
    label: "Status",
    options: [
      { value: "shape", label: "Shape" },
      { value: "dot", label: "Dot" },
      { value: "hidden", label: "Hidden", title: "Pending requests stay visible" },
    ],
  },
  {
    id: "time",
    description: "Last activity on each row. Hovering a row swaps it for the row actions.",
    label: "Time",
    options: [
      { value: "none", label: "None" },
      { value: "relative", label: "Relative" },
      { value: "absolute", label: "Absolute" },
    ],
  },
  {
    id: "label",
    description: "How a conversation label shows under its title.",
    label: "Label",
    options: [
      { value: "chip", label: "Chip" },
      { value: "dot", label: "Dot" },
      { value: "hidden", label: "Hidden" },
    ],
  },
  {
    id: "provider",
    description:
      "The harness logo at the end of each row, optionally with the model under the title.",
    label: "Provider",
    options: [
      { value: "logo", label: "Logo" },
      { value: "logo_model", label: "Logo + model" },
      { value: "hidden", label: "Hidden" },
    ],
  },
];

const ROW_ELEMENTS: readonly { id: ToggleId; label: string }[] = [
  { id: "worktreeIcon", label: "Worktree icon" },
  { id: "branch", label: "Branch" },
  { id: "diff", label: "Diff stats" },
  { id: "pr", label: "Pull request" },
  { id: "ports", label: "Ports" },
  { id: "activity", label: "Shells & tabs" },
];

/** State and actions shared by the popover form and the Settings section. */
export function useSidebarDisplayForm() {
  const { config, isFetched } = useSidebarSettings();
  const setOption = useSetSidebarOption();
  const { reset, isResetting } = useResetSidebarConfig();
  return useMemo(
    () => ({ config, setOption, reset, isResetting, disabled: !isFetched || isResetting }),
    [config, setOption, reset, isResetting, isFetched],
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
          aria-label={form.isResetting ? "Resetting" : "Loading options"}
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
      {CHOICE_ROWS.map((row) => (
        <OptionRow key={row.id} label={row.label}>
          <ChoiceControl form={form} row={row} />
        </OptionRow>
      ))}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-muted-foreground">Show in rows</span>
        <RowElementGrid form={form} className="gap-x-3 gap-y-1.5" />
      </div>
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
      <PopoverContent side="right" align="start" sideOffset={sideOffset} className="w-[22rem] p-3">
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
