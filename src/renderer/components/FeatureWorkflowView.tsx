import { FeatureTopBar } from "@/components/FeatureTopBar";
import { AgentSession } from "@/components/AgentSession";
import { CheckCircle2Icon } from "lucide-react";
import { useFeatureState, type FeatureStatus } from "@/hooks/useFeatureState";
import { PlanSidebar } from "@/components/PlanSidebar";
import { PlanInputView } from "@/components/PlanInputView";
import { NextStepsBar } from "@/components/NextStepsBar";
import { useWorkflowAgents } from "@/hooks/useWorkflowAgents";

export function FeatureWorkflowView({
  featureId,
  projectId,
  feature,
  featureQuery,
}: {
  featureId: number;
  projectId: number;
  feature: { id: number; title: string; status: string; type: string; project_id: number; created_at: string } | undefined;
  featureQuery: { refetch: () => unknown };
}) {
  const wf = useWorkflowAgents({ featureId, projectId, featureQuery });

  const { view, actions } = useFeatureState({
    featureStatus: feature?.status as FeatureStatus | undefined,
    plan: { status: wf.plan.status, blocks: wf.plan.blocks },
    brainstorm: { status: wf.brainstorm.status, blocks: wf.brainstorm.blocks },
    execute: { status: wf.execute.status, blocks: wf.execute.blocks },
    risk: { status: wf.risk.status, blocks: wf.risk.blocks },
    review: { status: wf.review.status, blocks: wf.review.blocks },
  });

  return (
    <div className="relative flex h-full flex-col">
      <FeatureTopBar featureId={featureId} projectId={projectId} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {view === "plan-input" && (
          <PlanInputView
            description={wf.description}
            onDescriptionChange={wf.setDescription}
            onStartPlanning={wf.handleStartPlanning}
            onStartBrainstorming={wf.handleStartBrainstorming}
            isStartingPlan={wf.isStartingPlan}
            isStartingBrainstorm={wf.isStartingBrainstorm}
          />
        )}

        {(wf.hasAnyAgentOutput ||
          actions.canStartBuild ||
          actions.canStartRisk ||
          actions.canStartReview) && (
          <div className="space-y-2">
            {wf.sessionEntries.map((entry) => (
              <AgentSession
                key={entry.label}
                collapsible
                agentType={entry.type}
                label={entry.label}
                status={entry.status}
                blocks={entry.blocks}
                open={
                  wf.openAgent === entry.label ||
                  entry.status === "running" ||
                  entry.status === "paused"
                }
                onToggle={() =>
                  wf.setOpenAgent((prev) =>
                    prev === entry.label ? null : entry.label,
                  )
                }
                pendingQuestions={
                  entry.type === "plan" && wf.plan.pendingQuestions.length > 0
                    ? wf.plan.pendingQuestions
                    : entry.type === "brainstorm" &&
                        wf.brainstorm.pendingQuestions.length > 0
                      ? wf.brainstorm.pendingQuestions
                      : undefined
                }
                onAnswerSubmit={
                  entry.type === "plan"
                    ? wf.handleQuestionResponse
                    : entry.type === "brainstorm"
                      ? wf.handleBrainstormQuestionResponse
                      : undefined
                }
                onSend={(message) => {
                  if (entry.type === "execute" && entry.subprocessId) {
                    wf.sendToExecuteSubprocess(entry.subprocessId, message);
                  } else {
                    wf.handleAgentSend(entry.type, message);
                  }
                }}
                onStop={() => {
                  if (entry.type === "execute" && entry.subprocessId) {
                    void wf.interruptExecuteSubprocess(entry.subprocessId);
                  } else {
                    void wf.handleAgentStop(entry.type);
                  }
                }}
                resumable={entry.resumable}
                onResume={
                  entry.type === "plan" || entry.type === "brainstorm"
                    ? () => void wf.handleResume(entry.type)
                    : undefined
                }
                // Review verdict props (only effective for review entries)
                reviewComplete={wf.reviewComplete}
                reviewVerdict={wf.reviewVerdict}
                onAddFixPhase={entry.type === "review" ? wf.handleAddFixPhase : undefined}
                onFixImmediately={entry.type === "review" ? wf.handleFixImmediately : undefined}
                isAddingFixPhase={wf.isAddingFixPhase}
                isStartingFix={wf.isStartingFix}
              />
            ))}

            <NextStepsBar
              show={
                wf.noAgentsRunning &&
                (actions.canStartBuild ||
                  actions.canStartRisk ||
                  actions.canStartReview)
              }
              canStartBuild={actions.canStartBuild}
              canStartRisk={actions.canStartRisk}
              canStartReview={actions.canStartReview}
              executeStatus={wf.execute.status}
              onStartBuilding={wf.handleStartBuilding}
              onStartRisk={wf.handleStartRisk}
              onStartReview={wf.handleStartReview}
              isStartingExecute={wf.isStartingExecute}
              isStartingRisk={wf.isStartingRisk}
              isStartingReview={wf.isStartingReview}
            />

            {view === "done" && (
              <div className="flex items-center gap-3 pt-4">
                <CheckCircle2Icon className="size-8 text-green-600" />
                <div>
                  <h2 className="text-lg font-semibold">Feature Complete</h2>
                  <p className="text-sm text-muted-foreground">
                    This feature has been reviewed and marked as done.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {view === "done" && !wf.hasAnyAgentOutput && (
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle2Icon className="size-8 text-green-600" />
              <div>
                <h2 className="text-lg font-semibold">Feature Complete</h2>
                <p className="text-sm text-muted-foreground">
                  This feature has been reviewed and marked as done.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
        <PlanSidebar featureId={featureId} />
      </div>
    </div>
  );
}
