import { useId, useState } from "react";
import { ChevronRight, ShieldAlert } from "lucide-react";
import type { PluginTabSummary, Project } from "@/api/generated";
import { PluginTabIcon } from "@/components/plugin-tabs/PluginTabIcon";
import { cn } from "@/lib/utils";
import {
  customTabStatus,
  enablementSummary,
  isSwitchedOnAnywhere,
  type ProjectOverride,
} from "./custom-tab-model";
import { CustomTabStatusBadge } from "./CustomTabStatusBadge";
import { CustomTabDetails } from "./CustomTabDetails";
import type { CustomTabEnablement } from "./useCustomTabEnablement";
import type { OpenCustomTabProject } from "./useOpenCustomTabProject";

export interface CustomTabCardProps {
  tab: PluginTabSummary;
  projects: Project[];
  overrides: ReadonlyMap<number, ProjectOverride>;
  enablement: CustomTabEnablement;
  opener: OpenCustomTabProject;
  defaultExpanded?: boolean;
}

/**
 * One local custom tab: what it is and where it is on at a glance, the rest —
 * permissions, availability, settings, issues — one click away. An invalid
 * tab still gets its card, with the issues that keep it from running.
 */
export function CustomTabCard(props: CustomTabCardProps): React.JSX.Element {
  const { tab, projects, overrides, defaultExpanded = false } = props;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const detailsId = useId();
  const projectIds = projects.map((project) => project.id);
  const summary = enablementSummary(tab, overrides, projectIds);
  // An invalid tab can't be consented to; its issues say why it is off.
  const paused =
    tab.status === "valid" &&
    tab.enablement.consent_required &&
    isSwitchedOnAnywhere(tab, overrides);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-100 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-foreground">
          <PluginTabIcon svg={tab.icon_svg} data-testid="custom-tab-icon" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{tab.name}</span>
            {tab.version ? (
              <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                v{tab.version}
              </span>
            ) : null}
            <CustomTabStatusBadge status={customTabStatus(tab)} />
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {tab.description || tab.id}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 self-center">
          {paused ? (
            <span className="flex items-center gap-1 text-xs font-medium text-[var(--acc-orange)]">
              <ShieldAlert className="size-3.5" aria-hidden />
              Needs consent
            </span>
          ) : (
            <span
              className={cn(
                "text-xs",
                summary === "Off" ? "text-muted-foreground" : "font-medium text-foreground",
              )}
            >
              {summary}
            </span>
          )}
          <ChevronRight
            aria-hidden
            className={cn(
              "size-4 text-muted-foreground transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
        </span>
      </button>
      {expanded ? (
        <div id={detailsId} className="border-t border-border/60">
          <CustomTabDetails {...props} paused={paused} />
        </div>
      ) : null}
    </div>
  );
}
