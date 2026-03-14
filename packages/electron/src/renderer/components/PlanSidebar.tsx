import { useRef, useState, useCallback } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFeaturePlan, getGetFeaturePlanQueryKey,
  useGetFeaturePrd, useResetPhase, useOverridePhaseStatus,
} from "@/api/generated";
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
import { RotateCcw, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { getActiveFocusZone } from "@/lib/focus-zones";
import { PHASE_STATUS_CONFIG } from "@/lib/phase-status";

interface PlanSidebarProps {
  featureId: number;
}


export function PlanSidebar({ featureId }: PlanSidebarProps) {
  const [expandedPhase, setExpandedPhase] = useState<PhaseData | null>(null);
  const [showPrd, setShowPrd] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const queryClient = useQueryClient();
  const { data: plan } = useGetFeaturePlan(featureId);
  const { data: prdData } = useGetFeaturePrd(featureId);
  const resetPhase = useResetPhase({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetFeaturePlanQueryKey(featureId) });
      void queryClient.invalidateQueries({ queryKey: ["sessions", "agentState", featureId] });
    },
  });
  const overridePhaseStatus = useOverridePhaseStatus({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetFeaturePlanQueryKey(featureId) });
      void queryClient.invalidateQueries({ queryKey: ["sessions", "agentState", featureId] });
    },
  });

  const canResetPhase = useCallback((phase: PhaseData, index: number) => {
    if (phase.status !== "completed" && phase.status !== "done" && phase.status !== "error") return false;
    if (!plan) return false;
    const nextPhase = plan.phases[index + 1];
    if (nextPhase && (nextPhase.status === "done" || nextPhase.status === "completed")) return false;
    return true;
  }, [plan]);

  const handleResetPhase = useCallback((phase: PhaseData) => {
    if (confirm(`Reset "${phase.title}" to pending? This will delete its agent sessions and messages.`)) {
      resetPhase.mutate({ phaseId: phase.id });
      setExpandedPhase(null);
    }
  }, [resetPhase]);

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

  const prd = prdData?.prd;

  if (!plan && !prd) return null;

  const config = expandedPhase
    ? PHASE_STATUS_CONFIG[expandedPhase.status] ?? PHASE_STATUS_CONFIG.pending
    : null;

  return (
    <>
      <div
        ref={containerRef}
        data-focus-zone="right-sidebar"
        tabIndex={0}
        className="flex h-full w-80 shrink-0 flex-col outline-none"
        onFocus={(e) => {
          if (e.target === e.currentTarget && !e.currentTarget.matches(":active")) {
            const firstItem = e.currentTarget.querySelector("[data-nav-item]") as HTMLElement | null;
            if (firstItem) firstItem.focus();
          }
        }}
      >
        {plan && (
          <div className="flex items-center px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">{plan.title}</h3>
          </div>
        )}
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col gap-0.5 px-4 py-2 overflow-hidden">
            {prd && (
              <button
                type="button"
                onClick={() => setShowPrd(true)}
                className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--drac-purple)]/40 bg-[var(--drac-purple)]/15 px-3 py-2.5 text-left transition-colors hover:bg-[var(--drac-purple)]/25"
              >
                <FileText className="size-4 shrink-0 text-[var(--drac-purple)]" />
                <span className="text-sm font-medium text-foreground">PRD</span>
              </button>
            )}
            {plan && (() => {
              const grouped: Record<number, { phase: PhaseData; index: number }[]> = {};
              plan.phases.forEach((phase, index) => {
                const step = phase.step_number;
                if (!grouped[step]) grouped[step] = [];
                grouped[step].push({ phase, index });
              });
              return Object.entries(grouped).map(([stepNum, phases]) => (
                <div key={stepNum}>
                  <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
                    <span className="flex-1 border-t border-border/50" />
                    <span className="shrink-0">Step {stepNum}</span>
                    <span className="flex-1 border-t border-border/50" />
                  </div>
                  {phases.map(({ phase, index }) => (
                    <div
                      key={phase.id}
                      data-nav-item
                      data-nav-phase-index={index}
                      tabIndex={-1}
                      className="rounded-lg outline-none"
                    >
                      <PhaseCard
                        phase={phase}
                        displayNumber={index + 1}
                        onExpand={setExpandedPhase}
                        canReset={canResetPhase(phase, index)}
                        onReset={handleResetPhase}
                        onOverrideStatus={(phase, status) =>
                          overridePhaseStatus.mutate({ phaseId: phase.id, status: status as "pending" | "running" | "completed" | "error" })
                        }
                      />
                    </div>
                  ))}
                </div>
              ));
            })()}
          </div>
        </ScrollArea>
      </div>

      <Dialog
        open={expandedPhase !== null}
        onOpenChange={(open) => { if (!open) setExpandedPhase(null); }}
      >
        {expandedPhase && config && (
          <DialogContent className="!max-w-[90vw] !w-[90vw] !max-h-[90vh] !flex !flex-col overflow-hidden">
            <DialogHeader className="shrink-0">
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
                {(() => {
                  const idx = plan?.phases.findIndex((p) => p.id === expandedPhase.id) ?? -1;
                  return canResetPhase(expandedPhase, idx) ? (
                    <button
                      onClick={() => handleResetPhase(expandedPhase)}
                      className="ml-auto flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-[var(--drac-orange)]"
                    >
                      <RotateCcw className="size-3" />
                      Reset
                    </button>
                  ) : null;
                })()}
              </div>
            </DialogHeader>

            <ScrollArea className="flex-1 min-h-0 mt-4 overflow-auto">
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

      <Dialog
        open={showPrd}
        onOpenChange={(open) => { if (!open) setShowPrd(false); }}
      >
        {prd && (
          <DialogContent className="!max-w-[90vw] !w-[90vw] !max-h-[90vh] !flex !flex-col overflow-hidden">
            <DialogHeader className="shrink-0">
              <div className="flex items-center gap-3">
                <FileText className="size-5 shrink-0 text-[var(--drac-purple)]" />
                <DialogTitle className="text-lg">Product Requirements Document</DialogTitle>
              </div>
              <DialogDescription className="sr-only">
                Full product requirements document
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 min-h-0 mt-4 overflow-auto">
              <Markdown content={prd} />
            </ScrollArea>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
