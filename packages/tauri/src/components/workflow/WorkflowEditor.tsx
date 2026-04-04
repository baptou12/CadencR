import { GitFork, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { WorkflowDefinition } from "@/api/generated";
import { PhaseList } from "./PhaseList";
import { TemplateEditorPanel } from "./TemplateEditorPanel";
import { useWorkflowEditor } from "./useWorkflowEditor";

export interface WorkflowEditorProps {
  definitionId?: number;
  forkFromId?: number;
  onSave: (definition: WorkflowDefinition) => void;
  onCancel: () => void;
  onFork?: () => void;
}

export function WorkflowEditor({ definitionId, forkFromId, onSave, onCancel, onFork }: WorkflowEditorProps) {
  const editor = useWorkflowEditor({ definitionId, forkFromId, onSave });

  if (editor.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 border-b border-border p-5 space-y-4">
        {editor.isPreset ? (
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{editor.name}</h2>
              {editor.description && (
                <p className="text-sm text-muted-foreground mt-0.5">{editor.description}</p>
              )}
            </div>
            {onFork && (
              <Button size="sm" onClick={onFork}>
                <GitFork className="size-3.5 mr-1" />
                Fork & Customize
              </Button>
            )}
          </div>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-semibold">
                {forkFromId ? "Fork Workflow" : definitionId ? "Edit Workflow" : "New Workflow"}
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                A workflow defines the sequence of phases an AI agent follows to complete a feature.
                Each phase has its own system prompt, command template, and artifact output.
              </p>
            </div>
            <div className="space-y-3 max-w-lg">
              <div className="space-y-1.5">
                <label htmlFor="wf-name" className="text-sm font-medium">
                  Name <span className="text-destructive">*</span>
                </label>
                <Input
                  id="wf-name"
                  value={editor.name}
                  onChange={(e) => editor.handleNameChange(e.target.value)}
                  placeholder="e.g. Design → Implement → Review"
                />
                <p className="text-xs text-muted-foreground">
                  A short, descriptive name for this workflow.
                </p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="wf-desc" className="text-sm font-medium">
                  Description
                </label>
                <Textarea
                  id="wf-desc"
                  value={editor.description}
                  onChange={(e) => editor.setDescription(e.target.value)}
                  placeholder="Describe when to use this workflow and what makes it different..."
                  rows={2}
                  className="resize-none"
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 flex min-h-0">
        {/* Phase list */}
        <div className="w-72 shrink-0 border-r border-border overflow-y-auto">
          <PhaseList
            phases={editor.phases}
            selectedPhaseId={editor.selectedPhaseId}
            isPreset={editor.isPreset}
            onSelect={editor.setSelectedPhaseId}
            onDelete={editor.handleDeletePhase}
            onReorder={editor.handleReorder}
            onAdd={editor.handleAddPhase}
          />
        </div>

        {/* Template editor */}
        <div className="flex-1 min-w-0">
          {editor.selectedPhase ? (
            <TemplateEditorPanel
              phase={editor.selectedPhase}
              activeTab={editor.activeTab}
              onTabChange={editor.setActiveTab}
              onUpdate={(updates) => editor.handleUpdatePhase(editor.selectedPhase!.id, updates)}
              isPreset={editor.isPreset}
              allPrecedingPhases={editor.phases
                .filter((p) => p.order_index < editor.selectedPhase!.order_index)
                .map((p) => ({ id: p.id, slug: p.slug, name: p.name }))}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              {editor.phases.length === 0
                ? "Add a phase to get started"
                : "Select a phase to edit its templates"}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border p-3 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() => void editor.handleSave()}
          disabled={editor.isMutating || editor.isPreset || !editor.name.trim()}
        >
          {editor.isMutating && <Loader2 className="size-4 animate-spin mr-1" />}
          {forkFromId ? "Fork & Save" : "Save"}
        </Button>
      </div>
    </div>
  );
}
