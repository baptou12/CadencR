/**
 * WorkflowInputBar — bottom bar for starting a custom workflow.
 * Shows a text input + "Start Workflow" button, with optional image upload.
 */

import { useState, useCallback } from "react";
import { Loader2Icon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImageAttachmentButton } from "@/components/ImageAttachmentButton";
import { ImageAttachmentPreview } from "@/components/ImageAttachmentPreview";
import { useImageAttachments } from "@/hooks/useImageAttachments";

interface WorkflowInputBarProps {
  onStart: (description: string) => void;
  isStarting: boolean;
  workflowName: string;
}

export function WorkflowInputBar({ onStart, isStarting, workflowName }: WorkflowInputBarProps) {
  const [text, setText] = useState("");
  const { attachments, addFiles, removeAttachment, clearAttachments } = useImageAttachments();

  const handleStart = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    onStart(trimmed);
    setText("");
    clearAttachments();
  }, [text, attachments.length, onStart, clearAttachments]);

  return (
    <div className="flex flex-col gap-2 border-t border-gray-800 bg-[#181A25] px-4 py-3">
      {attachments.length > 0 && (
        <ImageAttachmentPreview attachments={attachments} onRemove={removeAttachment} />
      )}
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleStart();
              }
            }}
            placeholder={`Describe what you want to build with ${workflowName}...`}
            rows={2}
            disabled={isStarting}
            className="max-h-32 min-h-[42px] resize-none border-border/50 bg-muted/40 py-2 pr-10 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-ring/40"
          />
          <div className="absolute bottom-1.5 right-1.5">
            <ImageAttachmentButton onFilesSelected={addFiles} disabled={isStarting} />
          </div>
        </div>
        <Button
          onClick={handleStart}
          disabled={isStarting || (!text.trim() && attachments.length === 0)}
          className="h-[42px] gap-2 shrink-0"
        >
          {isStarting ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <PlayIcon className="size-4" />
          )}
          Start Workflow
        </Button>
      </div>
    </div>
  );
}
