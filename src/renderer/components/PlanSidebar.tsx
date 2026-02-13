import { useState } from "react";
import { trpc } from "@/trpc";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
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
import { CircleIcon, Loader2, CheckCircle2, XCircle, ChevronsRight, ChevronsLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PlanSidebarProps {
  featureId: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const statusConfig: Record<string, { icon: React.ElementType; className: string; badgeClassName: string; label: string }> = {
  pending: { icon: CircleIcon, className: "text-muted-foreground", badgeClassName: "bg-muted text-foreground", label: "Pending" },
  running: { icon: Loader2, className: "text-[var(--drac-orange)] animate-spin", badgeClassName: "bg-[var(--drac-orange)]/20 text-[var(--drac-orange)]", label: "Running" },
  completed: { icon: CheckCircle2, className: "text-[var(--drac-green)]", badgeClassName: "bg-[var(--drac-green)]/20 text-[var(--drac-green)]", label: "Completed" },
  done: { icon: CheckCircle2, className: "text-[var(--drac-green)]", badgeClassName: "bg-[var(--drac-green)]/20 text-[var(--drac-green)]", label: "Done" },
  error: { icon: XCircle, className: "text-[var(--drac-red)]", badgeClassName: "bg-[var(--drac-red)]/20 text-[var(--drac-red)]", label: "Error" },
};

export function PlanSidebar({ featureId, collapsed, onToggleCollapse }: PlanSidebarProps) {
  const [expandedPhase, setExpandedPhase] = useState<PhaseData | null>(null);

  const { data: plan } = trpc.features.getPlanWithPhases.useQuery({ feature_id: featureId });

  if (!plan) return null;

  const config = expandedPhase
    ? statusConfig[expandedPhase.status] ?? statusConfig.pending
    : null;

  return (
    <>
      <div className="flex h-full shrink-0 flex-col border-l border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          {!collapsed && <h3 className="text-sm font-semibold text-foreground">{plan.title}</h3>}
          {onToggleCollapse && (
            <Button variant="ghost" size="icon" className="size-6 shrink-0" onClick={onToggleCollapse}>
              {collapsed ? <ChevronsLeft className="size-4" /> : <ChevronsRight className="size-4" />}
            </Button>
          )}
        </div>
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-3 p-3">
            {plan.phases.map((phase) => (
              <PhaseCard
                key={phase.id}
                phase={phase}
                onExpand={setExpandedPhase}
              />
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
            </ScrollArea>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
