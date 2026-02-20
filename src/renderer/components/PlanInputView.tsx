import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2Icon } from "lucide-react";
import { AGENT_ICONS } from "@/components/agent-icons";
import { KbdShortcut } from "@/components/KbdShortcut";
import { useImageAttachments } from "@/hooks/useImageAttachments";
import { ImageAttachmentPreview } from "@/components/ImageAttachmentPreview";
import { ImageAttachmentButton } from "@/components/ImageAttachmentButton";
import { cn } from "@/lib/utils";

export interface PlanInputImage {
  base64: string;
  mimeType: string;
}

interface PlanInputViewProps {
  description: string;
  onDescriptionChange: (value: string) => void;
  onStartPlanning: (images: PlanInputImage[]) => void;
  onStartBrainstorming: (images: PlanInputImage[]) => void;
  isStartingPlan: boolean;
  isStartingBrainstorm: boolean;
}

export function PlanInputView({
  description,
  onDescriptionChange,
  onStartPlanning,
  onStartBrainstorming,
  isStartingPlan,
  isStartingBrainstorm,
}: PlanInputViewProps) {
  const { attachments, addFiles, removeAttachment, clearAttachments, dragHandlers, isDragging } =
    useImageAttachments();

  const getImages = (): PlanInputImage[] =>
    attachments.map((a) => ({ base64: a.base64, mimeType: a.mimeType }));

  const handleStartPlanning = () => {
    const images = getImages();
    clearAttachments();
    onStartPlanning(images);
  };

  const handleStartBrainstorming = () => {
    const images = getImages();
    clearAttachments();
    onStartBrainstorming(images);
  };

  const isDisabled = !description.trim() || isStartingPlan || isStartingBrainstorm;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Start Planning</h2>
        <p className="text-sm text-muted-foreground">
          Describe the feature you want to build. The Plan agent will
          explore the codebase, ask clarifying questions, and generate a
          phased implementation plan.
        </p>
      </div>
      <div
        className={cn(
          "relative rounded-md transition-colors",
          isDragging && "ring-2 ring-blue-500 ring-offset-1",
        )}
        {...dragHandlers}
      >
        <Textarea
          autoFocus
          placeholder="Describe the feature you want to build..."
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!isDisabled) {
                handleStartPlanning();
              }
            }
          }}
          rows={6}
          className="resize-none"
        />
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-blue-500/10 pointer-events-none">
            <p className="text-sm font-medium text-blue-600">Drop images here</p>
          </div>
        )}
      </div>
      {attachments.length > 0 && (
        <ImageAttachmentPreview attachments={attachments} onRemove={removeAttachment} />
      )}
      <div className="flex items-center gap-2">
        <ImageAttachmentButton onFilesSelected={addFiles} />
        <Button
          onClick={handleStartPlanning}
          disabled={isDisabled}
        >
          {isStartingPlan ? (
            <Loader2Icon className="mr-2 size-4 animate-spin" />
          ) : (
            <AGENT_ICONS.plan className="mr-2 size-4" />
          )}
          Start Planning
          <KbdShortcut keys={["enter"]} />
        </Button>
        <Button
          variant="outline"
          onClick={handleStartBrainstorming}
          disabled={isDisabled}
        >
          {isStartingBrainstorm ? (
            <Loader2Icon className="mr-2 size-4 animate-spin" />
          ) : (
            <AGENT_ICONS.brainstorm className="mr-2 size-4" />
          )}
          Start Brainstorming
        </Button>
      </div>
    </div>
  );
}
