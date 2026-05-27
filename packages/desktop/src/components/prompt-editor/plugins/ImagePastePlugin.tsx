import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_NORMAL, PASTE_COMMAND } from "lexical";
import { ALLOWED_IMAGE_TYPES } from "@/hooks/useImageAttachments";

interface ImagePastePluginProps {
  onPasteImages?: (files: File[]) => void;
}

function extractImageFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];
  const files: File[] = [];
  for (const item of clipboardData.items) {
    if (item.kind !== "file") continue;
    if (!ALLOWED_IMAGE_TYPES.includes(item.type)) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

/** Forwards image files from clipboard pastes to `onPasteImages`; text-only pastes fall through. */
export function ImagePastePlugin({ onPasteImages }: ImagePastePluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onPasteImages) return;
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!event || !("clipboardData" in event)) return false;
        const images = extractImageFiles(event.clipboardData);
        if (images.length === 0) return false;
        event.preventDefault();
        onPasteImages(images);
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    );
  }, [editor, onPasteImages]);

  return null;
}
