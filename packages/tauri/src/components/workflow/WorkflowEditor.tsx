import { GitFork, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      <div className="shrink-0 border-b border-border p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Input
            value={editor.name}
            onChange={(e) => editor.handleNameChange(e.target.value)}
            placeholder="Workflow name"
            disabled={editor.isPreset}
            className="text-lg font-semibold h-9 max-w-md"
          />
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>slug:</span>
            <Input
              value={editor.slug}
              onChange={(e) => editor.handleSlugChange(e.target.value)}
              disabled={editor.isPreset}
              className="h-6 text-xs w-40 font-mono"
            />
          </div>
        </div>
        <Input
          value={editor.description}
          onChange={(e) => editor.setDescription(e.target.value)}
          placeholder="Description (optional)"
          disabled={editor.isPreset}
          className="h-8 text-sm max-w-lg"
        />
        {editor.isPreset && (
          <div className="flex items-center gap-3">
            <p className="text-xs text-amber-500">
              This is a preset workflow. Fork it to customize.
            </p>
            {onFork && (
              <Button size="sm" variant="outline" onClick={onFork}>
                <GitFork className="size-3.5 mr-1" />
                Fork & Customize
              </Button>
            )}
          </div>
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
            onUpdate={editor.handleUpdatePhase}
            onDelete={editor.handleDeletePhase}
            onReorder={editor.handleReorder}
            onAdd={editor.handleAddPhase}
            allPhaseSlugs={editor.phases.map((p) => ({ id: p.id, slug: p.slug, name: p.name }))}
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
