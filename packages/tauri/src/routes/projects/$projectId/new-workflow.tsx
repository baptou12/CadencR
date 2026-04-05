import { useState, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, GitBranchIcon, CheckIcon, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PresetPicker } from "@/components/workflow/PresetPicker";
import { useCreateFeature } from "@/api/generated";
import { PromptEditor } from "@/components/prompt-editor/PromptEditor";
import { ImageAttachmentButton } from "@/components/ImageAttachmentButton";
import { ImageAttachmentPreview } from "@/components/ImageAttachmentPreview";
import { useImageAttachments } from "@/hooks/useImageAttachments";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projects/$projectId/new-workflow")({
  component: NewWorkflowPage,
});

function NewWorkflowPage() {
  const { projectId } = Route.useParams();
  const numericProjectId = Number(projectId);
  const navigate = useNavigate();

  // null = Classic selected, undefined = nothing selected yet
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<
    number | null | undefined
  >(undefined);
  const [useWorktree, setUseWorktree] = useState(true);
  const [text, setText] = useState("");
  const {
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    dragHandlers,
    isDragging,
  } = useImageAttachments();

  const hasSelection = selectedDefinitionId !== undefined;
  const hasContent = text.trim().length > 0 || attachments.length > 0;
  const canSend = hasSelection && hasContent;

  const createFeature = useCreateFeature({
    onSuccess: (feature) => {
      void navigate({
        to: "/projects/$projectId/features/$featureId",
        params: { projectId, featureId: String(feature.id) },
        search: { initialDescription: text.trim(), useWorktree },
      });
    },
  });

  const handleSend = useCallback(() => {
    if (!canSend || createFeature.isLoading) return;
    createFeature.mutate({
      project_id: numericProjectId,
      type: "ws-feature",
      workflow_definition_id: selectedDefinitionId ?? undefined,
    });
  }, [canSend, createFeature, numericProjectId, selectedDefinitionId]);

  const handleEnterSend = useCallback(() => {
    if (!canSend || createFeature.isLoading) return true;
    handleSend();
    return true;
  }, [canSend, createFeature.isLoading, handleSend]);

  const handleSelect = useCallback((id: number | null) => {
    setSelectedDefinitionId(id);
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void navigate({ to: "/" })}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-2xl font-bold">New Workflow</h1>
        </div>

        <PresetPicker
          onSelect={handleSelect}
          selectedId={selectedDefinitionId ?? null}
        />

        {/* Prompt bar */}
        <div
          className={cn(
            "flex flex-col",
            isDragging && "ring-2 ring-primary/50 ring-inset rounded-lg",
          )}
          {...dragHandlers}
        >
          {attachments.length > 0 && (
            <ImageAttachmentPreview
              attachments={attachments}
              onRemove={removeAttachment}
              className="mb-2"
            />
          )}

          {/* Worktree chip */}
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUseWorktree((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                useWorktree
                  ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted/80",
              )}
            >
              <GitBranchIcon className="size-3" />
              Use worktree
              {useWorktree && <CheckIcon className="size-3" />}
            </button>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 py-4 pl-4 pr-2.5 transition-colors focus-within:bg-muted/55">
            <PromptEditor
              onChange={setText}
              onEnterSend={handleEnterSend}
              disabled={!hasSelection || createFeature.isLoading}
              placeholder={
                hasSelection
                  ? "Describe what you want to build..."
                  : "Select a workflow above to get started"
              }
              className="max-h-32 min-h-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 text-sm leading-[22px] shadow-none focus:border-0 focus:ring-0"
            />
            <div className="flex shrink-0 items-center gap-1.5 self-end">
              <ImageAttachmentButton
                onFilesSelected={addFiles}
                disabled={!hasSelection}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend || createFeature.isLoading}
                aria-label="Send message"
                className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
              >
                <Send className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
