/**
 * PhaseArtifactModal — shows all artifacts for a completed workflow phase.
 * Includes markdown preview and an "Open in Editor" button per artifact.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/Markdown";
import { Loader2Icon, PencilIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useListPhaseArtifacts, useGetFeatureArtifact, DEFAULT_ARTIFACT_TYPE } from "@/api/generated";
import type { WorkflowPhase } from "@/api/generated";

interface PhaseArtifactModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  featureId: number;
  phase: WorkflowPhase;
  onOpenInEditor: (phaseSlug: string, artifactTypes?: string[]) => void;
}

export function PhaseArtifactModal({
  open,
  onOpenChange,
  featureId,
  phase,
  onOpenInEditor,
}: PhaseArtifactModalProps) {
  const hasMultipleTypes = phase.artifact_types && phase.artifact_types.length > 0;

  // For phases with typed artifacts, fetch all; otherwise fetch the default one
  const { data: typedArtifacts, isLoading: loadingTyped } = useListPhaseArtifacts(
    featureId,
    phase.slug,
    { enabled: open && !!hasMultipleTypes },
  );

  const { data: defaultArtifact, isLoading: loadingDefault } = useGetFeatureArtifact(
    featureId,
    phase.slug,
    { enabled: open && !hasMultipleTypes },
  );

  const isLoading = hasMultipleTypes ? loadingTyped : loadingDefault;
  const artifacts = hasMultipleTypes
    ? typedArtifacts ?? []
    : defaultArtifact ? [defaultArtifact] : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] !max-w-[90vw] h-[80vh] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">{phase.name} — Artifacts</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {artifacts.length} artifact{artifacts.length !== 1 ? "s" : ""} produced by this phase
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : artifacts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No artifacts found.</p>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {artifacts.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifactType={artifact.artifact_type}
                content={artifact.content}
                defaultExpanded={artifacts.length === 1}
              />
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              onOpenInEditor(
                phase.slug,
                hasMultipleTypes ? phase.artifact_types : undefined,
              );
              onOpenChange(false);
            }}
          >
            <PencilIcon className="size-3.5" />
            Open in Editor
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function extractTitle(content: string, artifactType: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  if (artifactType !== DEFAULT_ARTIFACT_TYPE) return artifactType;
  return "Artifact";
}

function ArtifactCard({
  artifactType,
  content,
  defaultExpanded,
}: {
  artifactType: string;
  content: string;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const title = extractTitle(content, artifactType);

  return (
    <div className="rounded-md border border-gray-800">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/40"
      >
        {expanded
          ? <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          : <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="text-xs font-medium text-gray-200">{title}</span>
        {artifactType !== DEFAULT_ARTIFACT_TYPE && (
          <Badge variant="outline" className="px-1 py-0 text-[9px]">
            {artifactType}
          </Badge>
        )}
      </button>
      {expanded && (
        <div className="flex-1 overflow-y-auto border-t border-gray-800 px-3 py-2 text-sm">
          <Markdown content={content} />
        </div>
      )}
    </div>
  );
}
