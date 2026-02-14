import { useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { trpc } from "@/trpc";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/Markdown";
import { PhaseCard } from "@/components/PhaseCard";
import type { PhaseData } from "@/components/PhaseCard";
import { CircleIcon, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getActiveFocusZone } from "@/lib/focus-zones";

interface PlanSidebarProps {
  featureId: number;
}

const statusConfig: Record<string, { icon: React.ElementType; className: string; badgeClassName: string; label: string }> = {
  pending: { icon: CircleIcon, className: "text-muted-foreground", badgeClassName: "bg-muted text-foreground", label: "Pending" },
  running: { icon: Loader2, className: "text-[var(--drac-orange)] animate-spin", badgeClassName: "bg-[var(--drac-orange)]/20 text-[var(--drac-orange)]", label: "Running" },
  completed: { icon: CheckCircle2, className: "text-[var(--drac-green)]", badgeClassName: "bg-[var(--drac-green)]/20 text-[var(--drac-green)]", label: "Completed" },
  done: { icon: CheckCircle2, className: "text-[var(--drac-green)]", badgeClassName: "bg-[var(--drac-green)]/20 text-[var(--drac-green)]", label: "Done" },
  error: { icon: XCircle, className: "text-[var(--drac-red)]", badgeClassName: "bg-[var(--drac-red)]/20 text-[var(--drac-red)]", label: "Error" },
};

export function PlanSidebar({ featureId }: PlanSidebarProps) {
  const [expandedPhase, setExpandedPhase] = useState<PhaseData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: plan } = trpc.features.getPlanWithPhases.useQuery({ feature_id: featureId });

  const getNavItems = () => {
    if (!containerRef.current) return [];
    return Array.from(containerRef.current.querySelectorAll("[data-nav-item]")) as HTMLElement[];
  };

  const moveFocus = (direction: "up" | "down") => {
    const items = getNavItems();
    if (items.length === 0) return;

    const currentIndex = items.findIndex((el) => el === document.activeElement);
    let nextIndex: number;
    if (currentIndex === -1) {
      nextIndex = direction === "down" ? 0 : items.length - 1;
    } else if (direction === "down") {
      nextIndex = currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
    } else {
      nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    }
    items[nextIndex].focus({ focusVisible: true } as FocusOptions);
  };

  // CMD+OPT+DOWN: move focus down in the plan sidebar
  useHotkeys(
    "meta+alt+down",
    (e) => {
      if (getActiveFocusZone() !== "right-sidebar") return;
      e.preventDefault();
      moveFocus("down");
    },
    { enableOnFormTags: true },
  );

  // CMD+OPT+UP: move focus up in the plan sidebar
  useHotkeys(
    "meta+alt+up",
    (e) => {
      if (getActiveFocusZone() !== "right-sidebar") return;
      e.preventDefault();
      moveFocus("up");
    },
    { enableOnFormTags: true },
  );

  // Enter: expand the focused phase
  useHotkeys(
    "enter",
    (e) => {
      if (getActiveFocusZone() !== "right-sidebar") return;
      const focused = document.activeElement as HTMLElement | null;
      if (!focused?.hasAttribute("data-nav-item")) return;
      e.preventDefault();

      const phaseIndexStr = focused.getAttribute("data-nav-phase-index");
      if (phaseIndexStr == null || !plan) return;
      const phaseIndex = Number(phaseIndexStr);
      const phase = plan.phases[phaseIndex];
      if (phase) {
        setExpandedPhase(phase);
      }
    },
    { enableOnFormTags: false },
  );

  if (!plan) return null;

  const config = expandedPhase
    ? statusConfig[expandedPhase.status] ?? statusConfig.pending
    : null;

  return (
    <>
      <div
        ref={containerRef}
        data-focus-zone="right-sidebar"
        tabIndex={0}
        className="flex h-full w-80 shrink-0 flex-col border-l border-border outline-none focus-within:ring-2 focus-within:ring-blue-500/50"
      >
        <div className="flex items-center border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">{plan.title}</h3>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col gap-3 p-3">
            {plan.phases.map((phase, index) => (
              <div
                key={phase.id}
                data-nav-item
                data-nav-phase-index={index}
                tabIndex={-1}
                className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              >
                <PhaseCard
                  phase={phase}
                  displayNumber={index + 1}
                  onExpand={setExpandedPhase}
                />
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      <Dialog
        open={expandedPhase !== null}
        onOpenChange={(open) => { if (!open) setExpandedPhase(null); }}
      >
        {expandedPhase && config && (
          <DialogContent className="!max-w-[90vw] !w-[90vw] !max-h-[90vh] flex flex-col">
            <DialogHeader>
              <div className="flex items-center gap-3">
                {(() => {
                  const StatusIcon = config.icon;
                  return <StatusIcon className={cn("size-5 shrink-0", config.className)} />;
                })()}
                <DialogTitle className="text-lg">
                  Phase {expandedPhase.step_number}: {expandedPhase.title}
                </DialogTitle>
              </div>
              <DialogDescription className="sr-only">
                Phase {expandedPhase.step_number} details
              </DialogDescription>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className={config.badgeClassName}>
                  {config.label}
                </Badge>
                {expandedPhase.complexity != null && (
                  <Badge variant="outline">
                    Complexity: {expandedPhase.complexity}
                  </Badge>
                )}
              </div>
            </DialogHeader>

            <ScrollArea className="flex-1 min-h-0 mt-4">
              {expandedPhase.prompt && (
                <Markdown content={expandedPhase.prompt} />
              )}
              {expandedPhase.commit_message && (
                <div className="mt-4 rounded-md border border-border bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Commit message</p>
                  <code className="text-sm text-[var(--drac-green)]">
                    {expandedPhase.commit_message}
                  </code>
                </div>
              )}
              {expandedPhase.implementation_notes && (expandedPhase.status === "completed" || expandedPhase.status === "done") && (
                <div className="mt-4 rounded-md border border-border bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Implementation Notes</p>
                  <Markdown content={expandedPhase.implementation_notes} className="text-sm" />
                </div>
              )}
              {expandedPhase.deviations && (expandedPhase.status === "completed" || expandedPhase.status === "done") && (
                <div className="mt-4 rounded-md border border-[var(--drac-orange)]/40 bg-[var(--drac-orange)]/10 p-3">
                  <p className="text-xs font-medium text-[var(--drac-orange)] mb-1">Deviations</p>
                  <Markdown content={expandedPhase.deviations} className="text-sm" />
                </div>
              )}
            </ScrollArea>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
